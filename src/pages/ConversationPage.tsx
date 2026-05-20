import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAI } from '../contexts/AIContext';
import { PROVIDER_LABELS } from '../lib/aiClient';
import { fetchAIConversationResponse, fetchSpeakingSessionsHistory } from '../lib/speakingService';
import type { ChatMessage } from '../lib/speakingService';
import { Mic, MicOff, Send, Volume2, ChevronLeft, User, Sparkles, RefreshCw, AlertCircle, Bot } from 'lucide-react';

// Extend window for Web Speech API types
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (event: Event) => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: any) => void;
  onend: () => void;
}

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

  // Speech Recognition States
  const [isListening, setIsListening] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [speechError, setSpeechError] = useState<string | null>(null);


  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const isEn = locale === 'en';

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition() as SpeechRecognitionInstance;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US'; // English learning helper

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        setInputText(prev => {
          const separator = prev ? ' ' : '';
          return prev + separator + transcript;
        });
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event);
        setSpeechError(event.error || 'Speech input failed');
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.error(e);
      setRecognitionSupported(false);
    }
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setSpeechError(null);
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleSpeakText = (text: string) => {
    if (!('speechSynthesis' in window)) return;

    // Cancel ongoing synthesis
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    
    // Attempt to locate natural sounding Google English voice
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !inputText.trim() || submitting) return;

    const userMsgContent = inputText.trim();
    setInputText('');
    setSpeechError(null);

    const now = new Date().toISOString();
    const newMsg: ChatMessage = {
      role: 'user',
      content: userMsgContent,
      timestamp: now,
    };

    const updatedHistory = [...messages, newMsg];
    setMessages(updatedHistory);
    setSubmitting(true);

    try {
      const aiReply = await fetchAIConversationResponse(user.id, topic, updatedHistory, isMock, aiConfig);
      
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: aiReply, timestamp: new Date().toISOString() }
      ]);

      // Automatically speak the AI response
      handleSpeakText(aiReply);
    } catch (err) {
      console.error('Error getting AI reply:', err);
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
    // Cancel voices
    window.speechSynthesis.cancel();
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
                <div key={index} className={`chat-bubble-row ${isAssistant ? 'assistant-row' : 'user-row'}`}>
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
                        onClick={() => handleSpeakText(msg.content)}
                        style={{ marginTop: '6px' }}
                        title="Speak response"
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
              );
            })}
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
              <div className="error-banner-sm flex align-center gap-xs">
                <AlertCircle size={14} />
                <span className="body-xs">Speech Input Error: {speechError}</span>
              </div>
            )}
            
            <form onSubmit={handleSendMessage} className="flex align-center gap-sm">
              {recognitionSupported ? (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`btn btn-outline flex align-center justify-center ${isListening ? 'listening' : ''}`}
                  title={isListening ? 'Stop listening' : 'Start speaking input'}
                >
                  {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline flex align-center justify-center disabled"
                  title="Voice input not supported by browser"
                  disabled
                >
                  <MicOff size={18} style={{ opacity: 0.5 }} />
                </button>
              )}

              <input
                type="text"
                className="input flex-1"
                placeholder={isListening 
                  ? (isEn ? 'Listening... Speak now' : 'Đang lắng nghe... Hãy nói ngay') 
                  : (isEn ? 'Type your response here...' : 'Nhập câu trả lời của bạn...')
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
              >
                <Send size={16} />
              </button>
            </form>

            <span className="body-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
              {isListening 
                ? (isEn ? 'Voice active. Click microphone card again to stop recording.' : 'Micro đang mở. Click để dừng ghi âm.')
                : (isEn ? 'You can speak using the microphone button or type using your keyboard.' : 'Bạn có thể nói bằng micro hoặc nhập từ bàn phím.')
              }
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
