# LearnT

An English learning web application for Vietnamese intermediate learners, focused on three core skills: Speaking, Writing, and Vocabulary.

## Language

### People & Roles

**Learner**:
A Vietnamese intermediate-level English learner who uses LearnT to improve their speaking, writing, and vocabulary skills.
_Avoid_: User, student, player

### Core Skills

**Speaking**:
The skill module containing two practice modes: AI Conversation and Pronunciation Drill.
_Avoid_: Talking, oral practice

**Writing**:
The skill module containing two practice modes: Free Writing and Structured Exercises.
_Avoid_: Composition, essay

**Vocabulary**:
The skill module for learning and retaining English words using Flashcards organized by Topics, powered by FSRS scheduling.
_Avoid_: Words, lexicon

### Speaking Modes

**AI Conversation**:
A real-time dialogue between the Learner and an AI partner. The Learner speaks via microphone (speech-to-text), the AI responds with text and audio, forming a natural back-and-forth conversation.
_Avoid_: Chatbot, voice chat

**Pronunciation Drill**:
A focused exercise where the Learner listens to a model pronunciation and repeats it. The system compares the Learner's speech against the model and provides feedback on accuracy.
_Avoid_: Phonetics practice, speech drill

### Writing Modes

**Free Writing**:
The Learner receives a prompt/topic and writes a response of any length. The AI analyzes the submission for grammar errors, suggests better expressions, and provides an overall assessment.
_Avoid_: Essay mode, open writing

**Structured Exercise**:
An AI-generated grammar exercise in one of two formats: fill-in-the-blank or sentence reordering. Generated dynamically based on the Learner's current Vocabulary and skill level.
_Avoid_: Quiz, test, drill

### Vocabulary Concepts

**Flashcard**:
A digital card with a front (English word, pronunciation, audio) and back (Vietnamese meaning, example sentence, part of speech). Each Flashcard belongs to exactly one Topic and has its own FSRS scheduling state.
_Avoid_: Card, vocab item

**Topic**:
A thematic grouping of Flashcards (e.g., Travel, Business, Food, Health). Topics provide structure and a sense of progression for the Learner.
_Avoid_: Category, theme, chapter

**FSRS (Free Spaced Repetition Scheduler)**:
The scheduling algorithm that determines when each Flashcard should be reviewed next. Uses machine learning principles to optimize retention. More accurate than SM-2.
_Avoid_: SRS, spaced repetition (when referring to the specific algorithm)

**Review Session**:
A study session where the Learner reviews Flashcards that are due according to the FSRS schedule. The Learner rates each card (Again / Hard / Good / Easy) and FSRS recalculates the next review date.
_Avoid_: Study session, practice session

### Content

**Seed Data**:
Pre-built vocabulary content (words, meanings, examples, audio) stored in the database. Provides reliable, curated baseline content for Topics.
_Avoid_: Static data, base content

**AI-Generated Content**:
Structured Exercises, conversation responses, writing feedback, and supplementary vocabulary created on-the-fly by the LLM (Gemini API). Complements Seed Data.
_Avoid_: Dynamic content, generated content

### Motivation & Progress

**Streak**:
The count of consecutive days the Learner has completed at least one learning activity. Resets to zero if a day is missed.
_Avoid_: Combo, chain

**Daily Goal**:
A target number of activities the Learner aims to complete each day (e.g., review 20 Flashcards). Configurable by the Learner.
_Avoid_: Daily target, quota

**Progress Bar**:
A visual indicator showing how much of a Topic's Flashcards the Learner has studied/mastered.
_Avoid_: Completion meter, status bar

## Example Dialogue

> **Dev**: A Learner opens the app. What do they see first?
>
> **Domain Expert**: They land on the Dashboard — it shows their current Streak, Daily Goal progress, and quick-access cards for Speaking, Writing, and Vocabulary.
>
> **Dev**: They tap Vocabulary. Then what?
>
> **Domain Expert**: They see a list of Topics — Travel, Business, Food, etc. Each Topic shows a Progress Bar. They pick a Topic and either start learning new Flashcards or begin a Review Session for cards that are due.
>
> **Dev**: What if they want to practice Speaking?
>
> **Domain Expert**: They choose between AI Conversation or Pronunciation Drill. In AI Conversation, they pick a scenario (e.g., "ordering at a restaurant") and start talking. In Pronunciation Drill, they get individual words or sentences to repeat.
>
> **Dev**: And for Writing?
>
> **Domain Expert**: They choose Free Writing or Structured Exercise. Free Writing gives them a prompt and they write freely — AI gives detailed feedback. Structured Exercise generates fill-in-the-blank or sentence reordering problems based on vocabulary they've been learning.
