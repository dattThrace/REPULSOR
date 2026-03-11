# Lyria MIDI Controller

A professional-grade, AI-powered MIDI controller and live music performance tool. Lyria MIDI Controller bridges the gap between traditional MIDI hardware/software and the cutting-edge Lyria Live Music API, allowing performers to manipulate complex musical styles and textures in real-time using intuitive knob controls.

## 🌟 Features

- **AI-Driven Sound Synthesis**: Leverages the Lyria Live Music API to generate high-fidelity, real-time audio based on natural language prompts.
- **Dynamic Knob Mapping**: Generates a custom set of 16 knobs based on a user-provided musical style, categorized into "Styles", "Sonic Elements", and "Arrangement & Flow".
- **Advanced Mixing Strategies**:
    - **Linear**: Standard weighted mixing.
    - **Power Scale**: Adjusts sensitivity using a power function ($w^p$), useful for emphasizing dominant prompts.
    - **Softmax**: Normalizes weights using a softmax function with adjustable temperature, perfect for smooth transitions and avoiding single-prompt dominance.
- **MIDI Integration**: Full MIDI CC support. Map any hardware MIDI controller to the on-screen knobs for tactile performance.
- **Preset Persistence**: Save and recall your favorite knob configurations and mixing settings. Powered by a full-stack backend with SQLite.
- **Real-time Visualization**: Includes an audio visualizer and a weight history graph to monitor prompt influence over time.
- **Recording**: Capture your live performances directly to high-quality WAV files.

## 🛠 Tech Stack

- **Frontend**: [Lit](https://lit.dev/) (Web Components), Vite, Tailwind CSS.
- **Backend**: [Express.js](https://expressjs.com/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).
- **AI**: [Google Gemini API](https://ai.google.dev/) (for knob generation) and [Lyria Live Music API](https://deepmind.google/technologies/lyria/) (for audio generation).
- **Audio**: Web Audio API.

## 📂 Codebase Structure

```text
├── server.ts              # Express backend & Vite middleware entry point
├── index.tsx              # Main application component (LitElement)
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── Knob.ts        # Individual MIDI-mappable knob
│   │   ├── PromptController.ts # Grouped knobs and prompt logic
│   │   ├── WeightHistoryGraph.ts # D3-powered weight visualization
│   │   └── ...
│   ├── services/          # External API integrations
│   │   └── lyriaService.ts # Lyria API communication logic
│   ├── utils/             # Helper functions (MIDI, Audio, Math)
│   └── types.ts           # Global TypeScript definitions
├── database/              # SQLite database storage
└── public/                # Static assets
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- A Gemini API Key (with Lyria access)

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root and add your API key:
   ```env
   API_KEY=your_gemini_api_key_here
   ```

### Development

Start the full-stack development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

## 📡 API Endpoints

The backend provides the following endpoints for preset management:

- `GET /api/presets`: Retrieve all saved presets.
- `POST /api/presets`: Save a new preset.
- `DELETE /api/presets/:id`: Delete a preset.

## ☁️ Deployment (Vercel)

To deploy this application to Vercel:

1. **Database Consideration**: This app uses `better-sqlite3` which stores data in a local file (`presets.db`). Vercel's serverless environment has a read-only filesystem. For persistent presets in production, you should:
    - Switch to a hosted database like **PostgreSQL** (Vercel Postgres) or **MongoDB**.
    - Or, use a persistent disk solution if deploying to a VPS or container service (like Google Cloud Run).
2. **Environment Variables**: Add `API_KEY` to your Vercel project settings.
3. **Build Command**: `npm run build`
4. **Output Directory**: `dist` (for the frontend)

## 🤝 Contributing

Contributions are welcome! Please ensure you follow the existing code style and provide clear documentation for any new features.

---

*Built with ❤️ for the future of live music.*
