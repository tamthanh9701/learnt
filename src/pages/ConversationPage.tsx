import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAI } from '../contexts/AIContext';
import { PROVIDER_LABELS } from '../lib/aiClient';
import { fetchAIConversationResponse, fetchSpeakingSessionsHistory, streamAIConversationResponse } from '../lib/speakingService';
import { supportsStreaming } from '../lib/aiClient';
import { mergeSpeechTranscript } from '../lib/speechInput';
import type { ChatMessage } from '../lib/speakingService';
import { isCompleteFeedback } from '../lib/aiFeedback';
import { useSpeechRecognition, getSpeechErrorMessageKey } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { Mic, MicOff, Send, Volume2, ChevronLeft, User, Sparkles, RefreshCw, AlertCircle, Bot, ChevronDown, ChevronUp, CheckCircle, X, Lightbulb } from 'lucide-react';

export const ConversationPage: React.FC = () => {
  const { user, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const { config: aiConfig, isConfigured: aiIsConfigured } = useAI();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const sessionId = searchParams.get('session');
  
  // Conversation settings
  const [topic, setTopic] = useState('Technology & AI');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeSessionStarted, setActiveSessionStarted] = useState(false);

  // Speech + error states
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState(false);
  // Per-turn feedback-card expansion, keyed by message index (US-SPEAK-04 / BR-13).
  // Toggling one turn never affects another; ephemeral (resets on reload).
  const [expandedFeedback, setExpandedFeedback] = useState<Set<number>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isEn = locale === 'en';

  // Pseudo-live (Live v1): when auto-send is on, a pause in speech (VAD silence
  // timer) finalizes the turn and sends it — no manual Send press. The Learner
  // can toggle it off and adjust the pause length (slow/hesitant speakers).
  const [autoSend, setAutoSend] = useState(true);
  const [silenceMs, setSilenceMs] = useState(1800);
  // Live v2: stream the reply + speak it sentence-by-sentence ("speaks as it
  // thinks"). Only offered when the provider supports streaming (Gemini); the
  // trade-off is no structured feedback card on streamed turns (see PRD).
  const [streamReply, setStreamReply] = useState(false);
  // Refs so the recognizer's onSilence callback always sees the freshest input
  // + send function without re-instantiating the recognition instance.
  const inputTextRef = useRef('');
  const submittingRef = useRef(false);
  const sendMessageRef = useRef<(() => void) | null>(null);
  // Text typed BEFORE the current listening session started. The recognizer's
  // onResult carries the FULL accumulated transcript on every finalized chunk
  // (continuous mode), so we REPLACE the speech portion onto this base instead
  // of appending each time — otherwise each chunk re-appends the whole
  // accumulation and words duplicate ("hello hello world").
  const baseTextRef = useRef('');

  const { speak, cancel } = useSpeechSynthesis();
  const {
    isListening,
    isSupported: recognitionSupported,
    interimTranscript,
    toggle: toggleListening,
  } = useSpeechRecognition({
    lang: 'en-US',
    continuous: true,
    interimResults: true,
    silenceTimeoutMs: autoSend ? silenceMs : 0,
    onStart: () => {
      setSpeechError(null);
      // Snapshot whatever is already in the box so speech is appended once,
      // then replaced as the accumulation grows (no per-chunk duplication).
      baseTextRef.current = inputTextRef.current.trim();
    },
    onResult: (transcript) => {
      setInputText(mergeSpeechTranscript(baseTextRef.current, transcript));
    },
    onError: (code) => setSpeechError(t(getSpeechErrorMessageKey(code))),
    onSilence: () => {
      // VAD elapsed: auto-send the current turn if there is text to send and we
      // are not already awaiting a reply. Guarded by refs to dodge stale state.
      if (autoSend && !submittingRef.current && inputTextRef.current.trim()) {
        sendMessageRef.current?.();
      }
    },
  });

  const toggleFeedback = (index: number) => {
    setExpandedFeedback(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Scroll to bottom when messages update (and as interim transcript grows live)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimTranscript]);

  // Load existing session if sessionId parameter is supplied
  useEffect(() => {
    const loadSession = async () => {
      if (!user || !sessionId) return;
      try {
        const history = await fetchSpeakingSessionsHistory(user.id, isMock);
        const session = history.find(s => s.id === sessionId);
        if (session) {
          setTopic(session.topic);
          setMessages(session.messages);
          setActiveSessionStarted(true);
        }
      } catch (err) {
        console.error('Error loading speaking session:', err);
      }
    };
    loadSession();
  }, [user, sessionId, isMock]);

  // Keep VAD-callback refs fresh without re-instantiating the recognizer.
  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !inputText.trim() || submitting) return;

    const userMsgContent = inputText.trim();
    setInputText('');
    setSpeechError(null);
    setReplyError(false);

    const now = new Date().toISOString();
    const newMsg: ChatMessage = {
      role: 'user',
      content: userMsgContent,
      timestamp: now,
    };

    const updatedHistory = [...messages, newMsg];
    setMessages(updatedHistory);
    setSubmitting(true);

    const canStream = streamReply && !isMock && supportsStreaming(aiConfig);

    try {
      if (canStream) {
        // Live v2: stream a plain-text reply and speak each sentence as it
        // completes. We append one assistant bubble and grow its content as
        // deltas arrive. Persist the full reply once streaming ends.
        const replyTs = new Date().toISOString();
        setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: replyTs }]);
        const full = await streamAIConversationResponse(
          topic,
          updatedHistory,
          aiConfig,
          (sentence) => {
            // Speak each complete sentence the moment it arrives.
            speak(sentence);
            setMessages(prev => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === 'assistant') {
                copy[copy.length - 1] = {
                  ...last,
                  content: (last.content ? last.content + ' ' : '') + sentence,
                };
              }
              return copy;
            });
          },
        );
        // NOTE (v2 limitation, see PRD): streamed turns are not yet persisted to
        // speaking_sessions — streaming prioritises low-latency speech. A
        // dedicated persist path is planned; until then the streamed reply lives
        // in the on-screen session only. `full` is the completed reply text.
        void full;
      } else {
        const aiReply = await fetchAIConversationResponse(user.id, topic, updatedHistory, isMock, aiConfig);
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: aiReply, timestamp: new Date().toISOString() }
        ]);
        // Automatically speak the AI response
        speak(aiReply);
      }
    } catch (err) {
      console.error('Error getting AI reply:', err);
      setReplyError(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Expose the latest send fn to the VAD silence callback (avoids stale closure).
  // Assigned in an effect (not during render) per the react-hooks/refs rule.
  useEffect(() => {
    sendMessageRef.current = () => { void handleSendMessage(); };
  });

  const handleRetryReply = async () => {
    if (!user || submitting || messages.length === 0) return;
    setReplyError(false);
    setSubmitting(true);
    try {
      const aiReply = await fetchAIConversationResponse(user.id, topic, messages, isMock, aiConfig);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: aiReply, timestamp: new Date().toISOString() }
      ]);
      speak(aiReply);
    } catch (err) {
      console.error('Error retrying AI reply:', err);
      setReplyError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartSession = () => {
    if (!topic.trim()) return;
    setActiveSessionStarted(true);
    // Add default assistant initial prompt
    setMessages([
      {
        role: 'assistant',
        content: `Hi there! I am your English discussion partner. Let's chat about "${topic}". How are you doing today?`,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  const handleResetSession = () => {
    setMessages([]);
    setInputText('');
    setActiveSessionStarted(false);
    setReplyError(false);
    setExpandedFeedback(new Set());
    // Cancel voices
    cancel();
  };

  /**
   * Render the per-turn feedback card under a Learner's bubble (BR-12/13/23).
   * Three branches:
   *  A. complete feedback, errors.length > 0  -> correction card
   *  B. complete feedback, errors.length === 0 -> affirming "looks good" card
   *  C. absent / incomplete                    -> null (no card, no toggle)
   * Color is never the only signal: every state pairs an icon + text label.
   */
  const renderFeedbackCard = (msg: ChatMessage, index: number) => {
    const fb = msg.feedback;
    // Branch C: service collapses incomplete -> undefined; guard defensively anyway.
    if (!isCompleteFeedback(fb)) return null;

    const hasErrors = fb.errors.length > 0;
    const isExpanded = expandedFeedback.has(index);
    const cardId = `feedback-card-${index}`;
    const betterPhrasing =
      typeof fb.better_phrasing === 'string' && fb.better_phrasing.trim().length > 0
        ? fb.better_phrasing.trim()
        : null;

    return (
      <div className="feedback-card-wrap flex flex-col" style={{ alignItems: 'flex-end', width: '100%' }}>
        <button
          type="button"
          className="feedback-toggle-btn flex align-center gap-xs body-xs"
          onClick={() => toggleFeedback(index)}
          aria-expanded={isExpanded}
          aria-controls={cardId}
          aria-label={t('a11y.toggleFeedback')}
        >
          {hasErrors ? (
            <AlertCircle size={14} aria-hidden="true" style={{ color: 'var(--warning)' }} />
          ) : (
            <CheckCircle size={14} aria-hidden="true" style={{ color: 'var(--success)' }} />
          )}
          <span>
            {hasErrors
              ? `${t('speaking.feedbackErrors')} (${fb.errors.length})`
              : t('speaking.feedbackLooksGood')}
          </span>
          {isExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>

        {isExpanded && (
          <div id={cardId} className="feedback-card animate-fade-in flex flex-col gap-sm" role="region" aria-label={t('speaking.feedback')}>
            {/* Corrected text — shown for BOTH branches (the confirmed/rewritten sentence). */}
            <div className="feedback-section flex flex-col">
              <span className="body-xs font-semibold text-tertiary" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('speaking.feedbackCorrected')}
              </span>
              <p className="body-sm" style={{ color: 'var(--text-primary)' }}>{fb.corrected_text}</p>
            </div>

            {hasErrors ? (
              /* Branch A: discrete corrections list (color + icon + text). */
              <div className="feedback-section flex flex-col gap-xs">
                <span className="body-xs font-semibold text-tertiary" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('speaking.feedbackErrors')}
                </span>
                <ul className="feedback-errors-list flex flex-col gap-xs" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {fb.errors.map((err, ei) => (
                    <li key={ei} className="feedback-error-item flex flex-col">
                      <span className="flex align-center gap-xs body-sm" style={{ flexWrap: 'wrap' }}>
                        {typeof err.original === 'string' && err.original.length > 0 && (
                          <span className="feedback-original flex align-center gap-xs">
                            <X size={12} aria-hidden="true" style={{ color: 'var(--error)', flexShrink: 0 }} />
                            <span style={{ textDecoration: 'line-through', color: 'var(--error)' }}>{err.original}</span>
                          </span>
                        )}
                        {typeof err.correction === 'string' && err.correction.length > 0 && (
                          <span className="feedback-correction flex align-center gap-xs">
                            <CheckCircle size={12} aria-hidden="true" style={{ color: 'var(--success)', flexShrink: 0 }} />
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>{err.correction}</span>
                          </span>
                        )}
                      </span>
                      {typeof err.explanation === 'string' && err.explanation.length > 0 && (
                        <span className="body-xs text-secondary" style={{ marginLeft: '18px' }}>{err.explanation}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              /* Branch B: affirming "looks good" — empty errors[] is a RESULT, not a gap. */
              <div className="feedback-section flex align-center gap-xs">
                <CheckCircle size={14} aria-hidden="true" style={{ color: 'var(--success)', flexShrink: 0 }} />
                <span className="body-sm" style={{ color: 'var(--success)' }}>{t('speaking.feedbackLooksGood')}</span>
              </div>
            )}

            {betterPhrasing && (
              <div className="feedback-section flex flex-col">
                <span className="body-xs font-semibold text-tertiary flex align-center gap-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <Lightbulb size={12} aria-hidden="true" />
                  {t('speaking.feedbackBetterPhrasing')}
                </span>
                <p className="body-sm" style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>{betterPhrasing}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="conversation-container animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Navbar header */}
      <div className="flex justify-between align-center" style={{ marginBottom: 'var(--spacing-md)' }}>
        <button 
          className="btn btn-outline btn-sm flex align-center gap-xs"
          onClick={() => navigate('/speaking')}
        >
          <ChevronLeft size={16} />
          <span>{t('common.back')}</span>
        </button>
        <div className="flex align-center gap-xs">
          <h1 className="title-sm">{isEn ? 'AI Speaking Partner' : 'Gia sư luyện nói AI'}</h1>
          <span 
            className="body-xs font-semibold"
            style={{ 
              background: aiIsConfigured ? 'var(--primary)' : 'var(--bg-surface-hover)',
              color: aiIsConfigured ? 'var(--accent-text)' : 'var(--text-tertiary)',
              padding: '2px 8px', 
              borderRadius: 'var(--radius-full)',
              fontSize: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Bot size={10} />
            {aiIsConfigured ? PROVIDER_LABELS[aiConfig.provider] : 'Mock'}
          </span>
        </div>
      </div>

      {!activeSessionStarted ? (
        /* Setup screen */
        <div className="card topic-setup-card flex flex-col align-center text-center animate-fade-in" style={{ padding: 'var(--spacing-xl)', margin: '40px 0' }}>
          <Sparkles size={40} className="text-primary mb-md" />
          <h2 className="title-md" style={{ marginBottom: 'var(--spacing-sm)' }}>
            {isEn ? 'Choose Conversation Topic' : 'Chọn chủ đề nói chuyện'}
          </h2>
          <p className="body-sm text-secondary" style={{ marginBottom: 'var(--spacing-lg)', maxWidth: '450px' }}>
            {isEn
              ? 'Input a specific topic (e.g. Travel, Job Interview, Hobbies) and practice spoken dialog exchange.'
              : 'Nhập một chủ đề cụ thể (Ví dụ: Du lịch, Phỏng vấn, Sở thích) và thực hành đối thoại trực tiếp.'}
          </p>

          <div className="input-group" style={{ width: '100%', maxWidth: '400px', marginBottom: 'var(--spacing-lg)' }}>
            <input
              type="text"
              className="input text-center"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Job Interview Preparation"
            />
          </div>

          <button className="btn btn-primary btn-sm" onClick={handleStartSession} disabled={!topic.trim()}>
            {isEn ? 'Start Practice session' : 'Bắt đầu luyện tập'}
          </button>
        </div>
      ) : (
        /* Conversation Chat Screen */
        <div className="card chat-card flex flex-col animate-fade-in">
          {/* Chat header info */}
          <div className="chat-header-bar flex justify-between align-center">
            <div className="flex flex-col">
              <span className="body-xs text-tertiary">{isEn ? 'Topic' : 'Chủ đề'}</span>
              <span className="body-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{topic}</span>
            </div>
            
            <button className="btn btn-outline btn-xs flex align-center gap-xs" onClick={handleResetSession}>
              <RefreshCw size={12} />
              <span>{isEn ? 'Restart' : 'Làm mới'}</span>
            </button>
          </div>

          {/* Messages log */}
          <div className="chat-messages-area flex flex-col gap-md">
            {messages.map((msg, index) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div key={index} className="flex flex-col" style={{ width: '100%' }}>
                  <div className={`chat-bubble-row ${isAssistant ? 'assistant-row' : 'user-row'}`}>
                    {isAssistant && (
                      <div className="avatar assistant-avatar bg-primary-subtle text-primary">
                        <Sparkles size={16} />
                      </div>
                    )}

                    <div className={`chat-bubble ${isAssistant ? 'assistant-bubble' : 'user-bubble'}`}>
                      <p className="body-sm whitespace-pre-wrap">{msg.content}</p>

                      {isAssistant && (
                        <button
                          className="voice-speak-btn flex align-center justify-center"
                          onClick={() => speak(msg.content)}
                          style={{ marginTop: '6px' }}
                          aria-label={t('a11y.speakWord')}
                        >
                          <Volume2 size={14} />
                        </button>
                      )}
                    </div>

                    {!isAssistant && (
                      <div className="avatar user-avatar bg-secondary-subtle text-secondary">
                        <User size={16} />
                      </div>
                    )}
                  </div>

                  {/* Per-turn structured feedback under the Learner's bubble (BR-12/13/23) */}
                  {!isAssistant && renderFeedbackCard(msg, index)}
                </div>
              );
            })}
            {/* Live interim transcript while the Learner is speaking (BR-16 / D4).
                Provisional, non-committed text — muted + italic, announced politely. */}
            {isListening && interimTranscript && (
              <div className="chat-bubble-row user-row" aria-live="polite">
                <div className="chat-bubble user-bubble interim-bubble" style={{ opacity: 0.7 }}>
                  <p className="body-sm whitespace-pre-wrap" style={{ fontStyle: 'italic' }}>{interimTranscript}</p>
                </div>
                <div className="avatar user-avatar bg-secondary-subtle text-secondary">
                  <Mic size={16} />
                </div>
              </div>
            )}
            {submitting && (
              <div className="chat-bubble-row assistant-row">
                <div className="avatar assistant-avatar bg-primary-subtle text-primary">
                  <Sparkles size={16} />
                </div>
                <div className="chat-bubble assistant-bubble loading-bubble">
                  <div className="typing-loader">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input control block */}
          <div className="chat-input-controls flex flex-col gap-sm">
            {speechError && (
              <div className="error-banner-sm flex align-center gap-xs" role="alert">
                <AlertCircle size={14} />
                <span className="body-xs">{speechError}</span>
              </div>
            )}
            {replyError && (
              <div className="error-banner-sm flex align-center justify-between gap-xs" role="alert">
                <span className="flex align-center gap-xs">
                  <AlertCircle size={14} />
                  <span className="body-xs">{t('errors.conversationFailed')}</span>
                </span>
                <button type="button" className="btn btn-outline btn-xs" onClick={handleRetryReply} disabled={submitting}>
                  {t('common.tryAgain')}
                </button>
              </div>
            )}
            
            {recognitionSupported && (
              <div className="flex align-center gap-sm" style={{ flexWrap: 'wrap' }}>
                <label className="flex align-center gap-xs body-xs" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={(e) => setAutoSend(e.target.checked)}
                    aria-label={isEn ? 'Auto-send after I stop speaking' : 'Tự gửi khi tôi ngừng nói'}
                  />
                  <span>{isEn ? 'Auto-send when I pause' : 'Tự gửi khi tôi ngừng nói'}</span>
                </label>
                {autoSend && (
                  <label className="flex align-center gap-xs body-xs" style={{ color: 'var(--text-tertiary)' }}>
                    <span>{isEn ? 'Pause' : 'Khoảng dừng'}</span>
                    <input
                      type="range"
                      min={800}
                      max={4000}
                      step={200}
                      value={silenceMs}
                      onChange={(e) => setSilenceMs(Number(e.target.value))}
                      aria-label={isEn ? 'Silence pause length (ms)' : 'Độ dài khoảng dừng (ms)'}
                    />
                    <span>{(silenceMs / 1000).toFixed(1)}s</span>
                  </label>
                )}
                {supportsStreaming(aiConfig) && !isMock && (
                  <label className="flex align-center gap-xs body-xs" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={streamReply}
                      onChange={(e) => setStreamReply(e.target.checked)}
                      aria-label={isEn ? 'Speak reply as it streams' : 'Đọc câu trả lời ngay khi tạo'}
                    />
                    <span>{isEn ? 'Live reply (no feedback card)' : 'Trả lời trực tiếp (không có thẻ góp ý)'}</span>
                  </label>
                )}
              </div>
            )}

            <form onSubmit={handleSendMessage} className="flex align-center gap-sm">
              {recognitionSupported ? (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`btn btn-outline flex align-center justify-center ${isListening ? 'listening' : ''}`}
                  aria-pressed={isListening}
                  aria-label={isListening ? t('a11y.micStop') : t('a11y.micStart')}
                >
                  {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline flex align-center justify-center disabled"
                  aria-label={t('speech.unsupported')}
                  disabled
                >
                  <MicOff size={18} style={{ opacity: 0.5 }} />
                </button>
              )}

              <input
                type="text"
                className="input flex-1"
                placeholder={
                  !recognitionSupported
                    ? t('speech.typingFallback')
                    : isListening
                      ? t('speech.listeningInterim')
                      : t('speech.idleHint')
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={submitting}
              />

              <button
                type="submit"
                className="btn btn-primary btn-sm flex align-center justify-center"
                style={{ padding: '12px' }}
                disabled={submitting || !inputText.trim()}
                aria-label={t('a11y.sendMessage')}
              >
                <Send size={16} />
              </button>
            </form>

            <span className="body-xs text-center" style={{ color: 'var(--text-tertiary)' }} aria-live="polite">
              {!recognitionSupported
                ? t('speech.typingFallback')
                : isListening
                  ? t('speech.listeningInterim')
                  : t('speech.idleHint')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
