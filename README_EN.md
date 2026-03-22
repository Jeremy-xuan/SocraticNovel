<div align="center">
  <h1>SocraticNovel</h1>
  <p>We don't teach you knowledge. We guide you to discover it yourself.</p>

  <p>
    <img src="https://img.shields.io/badge/Version-v1.0-brightgreen.svg" alt="Version">
    <img src="https://img.shields.io/badge/Socratic_Method-Guided_Discovery-ff69b4.svg" alt="Socratic Method">
    <img src="https://img.shields.io/badge/Narrative_Layer-Literary_Immersion-9b59b6.svg" alt="Narrative Layer">
    <img src="https://img.shields.io/badge/Platform-Claude_Code-blue.svg" alt="Platform">
    <img src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-purple.svg" alt="License">
    <img src="https://img.shields.io/badge/PRs-Welcome-orange.svg" alt="PRs Welcome">
  </p>
</div>

<p align="center">
  <b>English</b> | <a href="./README.md">简体中文</a>
</p>

> Its purpose is simple — **make learning less lonely.**
>
> Textbooks and thick reference volumes are impossible to power through. Public lectures are too one-directional. Ask AI for help? It slaps a full page of formulas in your face — no matter how you study, you're always grinding alone. SocraticNovel is an open-source framework for creating **immersive AI tutoring systems**: the AI never gives direct answers, guiding you step by step through Socratic questioning to reach the answer yourself; teaching doesn't happen in a blank chatbox, but in a light novel world with characters, scenes, and everyday life.
>
> SocraticNovel creates companions for you. When you're studying, someone is truly there with you — not an encyclopedia, not a problem-solving machine, certainly not some distant professor on the other side of a screen. A person with a temper, who goes quiet sometimes, who woke up in a bad mood today but still made you "breakfast." You spend time together, you learn things, you meet people. When it's over, you remember. Not just the formulas.
>
> This project was extracted from a real, working AP Physics tutoring system. Answer a few questions from the AI — what do you want to study? What's the teacher's name? Where does the story take place? — and it generates the entire system for you. Any subject, any characters, any story you want to live through.
> You might even want to keep some tissues handy.

<br>

> *"The best teacher never gives you the answer. She just makes you suddenly realize — you knew it all along."*

---

## 📑 Table of Contents

- [🎯 What Problem Does It Solve](#-what-problem-does-it-solve)
- [✨ Why Learn This Way?](#-why-learn-this-way)
- [💡 Two Parallel Universes](#-two-parallel-universes)
- [🔑 Three Core Designs](#-three-core-designs)
- [🔬 From Work to Framework](#-from-work-to-framework)
- [📐 Go Deeper](#-go-deeper)
- [🕹️ How Do I Use It?](#️-how-do-i-use-it)
- [🏗 How It Works](#-how-it-works)
- [📂 Project Structure](#-project-structure)
- [🤖 Recommended Models](#-recommended-models)
- [🤝 Join Us](#-join-us)
- [📜 License & Acknowledgments](#-license--acknowledgments)

---

## 🎯 What Problem Does It Solve

You ask AI to teach you something. Three seconds later, it dumps a wall of derivations on you. You read the whole thing. You remember nothing — because from start to finish, you were just an audience.

That's only the surface problem. The deeper issue: **there's no "person" in AI teaching.** No teacher you'd remember, no weight accumulated through shared experience, no reason to open the chatbox again tomorrow. It's a vending machine — you insert a coin, it dispenses an answer, transaction complete.

SocraticNovel lets you create a completely different kind of AI learning experience:

- **The AI never gives answers** — It guides you with questions until you figure it out yourself. Socrates was doing this 2,400 years ago. Nobody had ever turned it into an engineered system.
- **Teaching happens inside a story** — Not a blank chatbox, but a literary world with scenes, shifting light, and characters' moods. Your teacher has a name, a past, and might be in a bad mood today — but will still teach you.
- **The AI won't forget you** — 15+ files each handling a specific role: mistake log, spaced review queue, session notes, group chat. A month later, it still remembers the mistake you made in lesson 3.

You don't need to know prompt engineering. You don't need to write a single line of code. Answer a few questions from the AI, and it generates everything.

---

## ✨ Why Learn This Way?

Have you ever asked an AI to teach you something?

Most of the time it goes like this: you ask a question, the AI immediately dumps a wall of step-by-step explanations at you. Neat, complete, soulless. You read through it. You learned nothing. Because **you were just watching someone else do the work the entire time.**

This is the fundamental problem with AI-assisted learning — **it turns "teaching" into "showing."** You're the audience, not the participant. You watch a flawless performance, and after it ends, you still can't do it yourself.

The deeper problem: **AI teaching has no connective tissue.**

Good teaching — whether tutoring, mentoring, or apprenticeship — always has a *reason* for two people to keep showing up. Not "we scheduled it for Wednesday afternoon" — but weight accumulated through shared experience. You remember that time the teacher paused mid-explanation because it started raining outside, and you both just listened for a moment. You remember that she went silent for a long time after you made the same mistake for the third time. *Those* memories are what make learning meaningful.

**An AI problem-solver can't give you any of that.**

SocraticNovel exists to fix this. It's an open-source framework for building immersive learning systems. Two core principles:

1. **Socratic Method** — The AI never gives direct answers. Every step of knowledge delivery happens through questions. You're not watching a derivation — you're being guided to complete it yourself.
2. **Light Novel Narrative Layer** — Teaching doesn't happen in a blank chatbox. It happens in a literary world with real scenes, shifting light, and fictional teachers with distinct personalities. Characters aren't skins — they're people with pasts, contradictions, and moods.

**This is not a visual novel. You don't need to "roleplay."** Just be a real student — work on problems, think, occasionally complain. The story moves on its own. You don't manage relationships, pick dialogue options, or pretend to care about the plot. When you're studying, you're studying — the story runs in the background, using the same time you're already spending.

> **Bonds aren't built through chat — they're built through doing.** Every time you show up because you genuinely don't understand something, you're accumulating time and traces between two people.

---

## 💡 Two Parallel Universes

You open your laptop. You have a question you can't figure out. You type it in.

Here's what happens in two parallel universes.

---

**❌ Universe A: AI Problem Solver**

> **You:** What is an electric field?
>
> **AI:** An electric field is a physical field that surrounds electrically charged particles. The electric field strength $\vec{E}$ is defined as the force per unit positive charge: $\vec{E} = \frac{\vec{F}}{q}$. Field lines originate from positive charges and terminate at negative charges. The field obeys the superposition principle. Let us derive the field produced by a point charge:
>
> Given a point charge $Q$ at the origin, place a test charge $q$ at distance $r$...
>
> *(The derivation continues for 800 words. You read the whole thing. You learned nothing. Because you were watching someone else do the work the entire time. Three minutes later you close the tab. Tomorrow you won't remember you studied this.)*

---

**✅ Universe B: SocraticNovel**

> Ritsu stands by the window, holding a cup of tea, in no hurry to begin. You've already sat down. The domed classroom's light is low today — 3 PM, the sun just dipped behind the ridge, and the copper walls shifted from gold to dark bronze.
>
> He glances at you and smiles — the unhurried kind.
>
> "Do you have WiFi at home?"
>
> You didn't expect that. "Yes."
>
> "Can you see it?"
>
> "No."
>
> "But you know it's there."
>
> He sets the cup on the table — white porcelain, tea stains baked permanently into the inner wall — and walks slowly to the whiteboard.
>
> "You've learned about gravity. Two objects with mass attract each other. So let me ask you — if you remove one object, what's left around the other one?"
>
> You think for a moment. "Nothing? Gravity needs two objects to exist."
>
> He doesn't deny you. He nods once, as if tasting your words.
>
> "Force does need two objects. But I wasn't asking about force."
>
> He draws a single, solitary dot on the whiteboard.
>
> "I was asking about — **the space itself.**"
>
> Three seconds of silence. The wind outside happened to stop.
>
> "Just like WiFi. You can't see it. But it's there. **The space has been changed.**"
>
> *(You thought you were talking about WiFi. You thought you were talking about gravity. Then you realized — you were already understanding electric fields. Not because someone told you the definition, but because you walked there yourself, from gravity to fields. Ritsu was just standing nearby.)*

---

No formula walls. No `*smiles gently*`. No announcing "today we're learning about electric fields."

In Universe A, you spent three minutes reading a derivation and had your entire day's mood ruined. In Universe B, you spent three minutes answering questions and remembered — not just the concept of a field, but what the domed classroom looked like that afternoon when the light went dark.

---

## 🔑 Three Core Designs

<br>

### ▎Narrative Anchoring

> **Knowledge isn't told — it's discovered inside a world with light, temperature, and silence.**

The AI starts from everyday experience, guiding you step by step toward understanding through continuous questioning. Right answers get deeper follow-ups. Wrong answers aren't corrected — you get a simpler question that helps you find the error yourself.

That's the Socratic method. It's been around for 2,400 years. Nobody had ever combined it with literary narrative.

In SocraticNovel, every teaching moment happens inside a concrete scene — with specific lighting angles, cup temperatures, and the teacher's psychological state that day. A character's pause might not be about the subject at all. These details aren't decoration — they're **memory anchors**. You'll forget which lesson a concept came from, but you'll remember "the light in the classroom dimmed one degree that afternoon."

<br>

### ▎Character Rotation

> **Not one teacher with three costumes. Multiple fundamentally different people.**

SocraticNovel supports 1-3 teacher characters. Each has independent teaching styles, personalities, and story arcs. The same concept gets completely different treatment from each teacher — you gain different cognitive angles in different lessons.

From the included AP Physics EM case study:

| Character | Teaching Style | Voice |
|-----------|---------------|-------|
| **Rin** | Precise theory, relentless questioning | Short sentences. Every word chosen. Silence as communication. |
| **Ritsu** | Daily-life analogies (music, cooking) | Unhurried long sentences, paced like cooking — every step has purpose. |
| **Saku** | Systems thinking, engineering mindset | Minimal. Subject-verb-object. Like an engineering report. |

Rotation is fixed — the story picks the teacher, not you. Each teacher is bound to specific narrative nodes. One teacher's class might teach you why precision matters. Another's analogy might turn out to be about something in their own past. Same building, same student, completely different learning experiences.

<br>

### ▎Distributed Memory

> **AI memory no longer depends on context windows — it has a real filesystem.**

Normal AI chat has a fatal flaw: talk long enough and it forgets. Context windows are finite — early conversations get pushed out. The mistake you made in lesson 3? By lesson 10, the AI has no memory of it.

SocraticNovel is different. 15+ files, each with a clear responsibility — learning progress, session logs, spaced review queue, mistake log, group chat, learner diary... After each lesson, the AI updates 8 files. Next session, it reads them back.

Result: **After a month, the AI still remembers the mistake you made in lesson 3.** Because that mistake is written in `mistake_log.md` — it doesn't get washed away by the sliding context window. Characters remember too — she knows you always mess up denominators, he remembers the tone of your first genuine "oh, I get it."

---

## 🔬 From Work to Framework

The usual approach: write a framework first, then generate works from it.

**We did it backwards.**

First came a fully functional AP Physics C: E&M immersive tutoring system — three teachers, 12 chapters, four emotional phases, every lesson's story nodes meticulously designed — then we reverse-engineered this framework from it.

Why backwards? Because **writing a complete work is far easier than writing an abstract framework.** Frameworks require you to define rules and logic at the abstract level — that's incredibly hard. But writing a story is different. You just need to know what *feeling* you want, and you'll know immediately whether it's right.

This also means every rule, every design decision in SocraticNovel wasn't conjured from thin air — it was validated against a real system. The Prose Standards aren't "we think it should be this way" — they're "we tried it, and it genuinely makes a difference."

> **SocraticNovel turns "design a complex system" (hard) into "answer the AI's questions" (easy).** You don't need to know Prompt Engineering — the Meta Prompt asks you what you want, step by step, then generates everything.

---

## 📐 Go Deeper

Want to understand the complete technical architecture behind SocraticNovel?

> **📖 [Architecture Whitepaper — ARCHITECTURE_EN.md](./ARCHITECTURE_EN.md)**
>
> Four-layer architecture deep dive (boot / pedagogy / narrative / runtime), design trade-offs, comparison with knowledge-base platforms. If you want to understand **why** this system is designed this way, not just **how** to use it, start here.

> **🎮 [Case Study — AP Physics C: E&M](./AP_Physics_EM/)**
>
> A fully functional three-teacher immersive physics tutoring system. 12 chapters, four emotional phases, every lesson's story nodes meticulously designed. This isn't a demo — it's a battle-tested production system. Launch it directly, or use it as reference when building your own.

---

## 🕹️ How Do I Use It?

### 🥇 Path A · Create Your Own System (Recommended)

1. Feed [`META_PROMPT.md`](./META_PROMPT.md) to Claude Code (or any AI that supports file I/O)
2. The AI asks you a series of questions: What subject? Teacher names? Personalities? Where does the story take place?
3. You answer. The AI generates the complete file system (15+ files).
4. In the generated directory, tell Claude Code: "Read CLAUDE.md and begin."

You don't need to write any prompts. Just answer questions.

### ⚙️ Path B · Use the AP Physics EM System Directly

1. Clone this repository
2. Launch Claude Code in the `AP_Physics_EM/` directory
3. Say: "Read CLAUDE.md and begin."
4. You'll see the observatory prologue. The story has started.

For anyone who wants to experience the system immediately, or is actually studying AP Physics.

### 🛋️ Path C · Knowledge-Base Lazy Deploy

No Claude Code? Claude Projects / ChatGPT Custom GPTs / Kimi will work:

1. After generating files via Path A, choose the "knowledge-base version" (the AI will merge files into 8-9 total)
2. Create a new project on your knowledge-base platform and upload all files
3. Tell the chatbox: "Read BOOT.md and begin."

> ⚠️ Knowledge-base versions don't have real file I/O — state tracking is maintained internally by the AI, which may drift over extended use. But it works perfectly as an entry point.

### Do I Need to Roleplay?

**No.**

- Throw problems directly: "I can't solve this Gauss's Law question"
- Complain freely: "This concept is insane"
- Respond minimally: "Yes" / "Don't get it"
- Ignore the story entirely — it progresses in the background

Two interaction triggers: say "check messages" to view the group chat, say "done for today" to end the session. That's it. The rest of the time, just study.

---

## 🏗 How It Works

```
┌──────────────────────────────────────────────────────┐
│                   Each New Session                     │
│                                                        │
│  CLAUDE.md → Three-tier loading → Pre-class prep       │
│                                                        │
│  ┌──────────────┐    ┌───────────┐    ┌─────────────┐ │
│  │ Chat empty?   │─Y→│ Play      │──→│ Group chat   │ │
│  │              │    │ prologue  │    │ icebreaker   │ │
│  │              │─N→ Normal class start               │ │
│  └──────────────┘                                      │
│                                                        │
│  Transition scene → Socratic teaching → Post-class     │
│                                                        │
│  Post-class: write to 8 files                          │
│  progress / session_log / review_queue / mistakes      │
│  character doc / diary / chat / knowledge_points       │
└──────────────────────────────────────────────────────┘
```

**Full architecture details → [ARCHITECTURE_EN.md](./ARCHITECTURE_EN.md)** | **Create your own system → [META_PROMPT_EN.md](./META_PROMPT_EN.md)**

---

## 📂 Project Structure

```
SocraticNovel/
├── 📄 README.md                      # Chinese version
├── 📄 README_EN.md                   # You are here
├── 📄 [ARCHITECTURE_EN.md](./ARCHITECTURE_EN.md)  # Architecture whitepaper
├── 📄 [META_PROMPT_EN.md](./META_PROMPT_EN.md)    # System generator (interactive)
│
├── 📁 [AP_Physics_EM/](./AP_Physics_EM/)          # ★ Case study: AP Physics C E&M
│   ├── CLAUDE.md                     # System entry point
│   ├── MAINTAINER.md                 # AI maintainer handbook
│   ├── teacher/
│   │   ├── story.md                  # World-building + prologue
│   │   ├── story_progression.md      # Story progression table
│   │   ├── config/                   # Teaching configuration
│   │   ├── characters/               # Three teacher profiles
│   │   └── runtime/                  # Runtime state files
│   └── materials/                    # Teaching materials
│
└── (Your generated system will have a similar structure)
```

---

## 🤖 Recommended Models

This system bans all cheap expressive shortcuts — no `*italic actions*`, no emoji floods, no "I'm here to hold your hand" emotional fast food. That puts extreme demands on a model's literary ability and instruction compliance.

🔥 **T0 · Unreserved Recommendation**
- **Claude Sonnet/Opus 4.6** — The undisputed ceiling for literary prose in AI. Restrained, precise writing that can produce "shifts in light replacing shifts in affection" — that subtle, literary quality. Native file system support makes it feel purpose-built for this system.
- **Gemini 3.1/3.0 Pro** — While still slightly behind Opus in overall quality, Gemini can run this system reasonably well. But never use Flash — if it gets the physics wrong, everyone looks like a clown.

🌟 **T1 · Strong Alternatives**
- **DeepSeek-V3.2** — Remarkable writing tension and obedience. Outstanding value for running this system, with a terrifying 1M+ context capacity.
- **Kimi K2.5** — Massive long-context throughput. Upload all 15 files to its knowledge base — it won't forget after a month of conversations.
- **Qwen3.5** — Latest version handles complex scene construction beautifully, with impressively smooth transitions between STEM problem-solving and narrative scenes.

❌ **Not Recommended**
- Small local models — frequently break the "zero bracket actions" rule, pad word count, and fall into dry problem-solving divorced from any scene. Disaster territory.
- Search-focused models — can't hold this many rules in their heads.
- **GPT-5.x** — Extremely precise logical reasoning, near-zero error rate on derivations. The "teaching" line is rock-solid, but if you don't want it to "warmly hold your hand" through everything, best to steer clear.

---

## 🤝 Join Us

Want to build your own version? Want to turn chemistry, math, or computer science into a learning experience with warmth?

1. Fork this project
2. Use Meta Prompt to generate your system, or improve the framework itself
3. Submit a PR — even fixing a typo is welcome

**Especially excited about:**
- 🎓 **Complete systems for new subjects** — What metaphor would you use for molecules in organic chemistry? What personality would a linear algebra teacher have? We'd love your answers.
- 🌍 **Characters from different cultures** — Doesn't have to be Japanese names. A French physics professor, an Indian mathematician, an American engineer — the world is big.
- 🔧 **Framework improvements** — If a rule feels wrong or a flow could be more elegant, just say so.
- 📖 **Your experience reports** — How did it go? What worked? What didn't? Honest feedback is worth more than any code change.

---

## 📜 License & Acknowledgments

### Acknowledgments

This project didn't appear from nothing. It stands on the shoulders of two people:

- **Socratic × AI Role-Play Teaching Method** — From [Wu Lemin (吴乐旻)](https://www.zhihu.com/people/wulemin)'s [article](https://zhuanlan.zhihu.com/p/2012398047620014256) introducing this learning approach. Using AI to role-play as a teacher and teach through Socratic questioning — this core idea came from him.
- **Light Novel Narrative Layer Design** — From [@AvalonSkyAfar](https://github.com/AvalonSkyAfar)'s original system (幽鬼 Learning Protocol / AnimaTutor, built upon it). Fusing literary narrative, character emotional arcs, and multi-dimensional character design into AI teaching — this creative vision came from him.

What I did was merely some modest work — reverse-engineering their ideas, abstracting the architecture, and iterating on the design. We distilled it into a reusable open-source framework, for everyone who loves it.

### License

This work is licensed under **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**.

You are free to share and adapt this work, provided you:

| Condition | Requirement |
|-----------|-------------|
| 🏷️ Attribution | Credit the original authors and link to the license |
| 🚫 NonCommercial | May not be used for commercial purposes |
| 🔄 ShareAlike | Adaptations must use the same license |

---

> *"When it's over, will you remember the formulas? Maybe. But you'll definitely remember the person."*
