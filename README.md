# Prompt DJ MIDI

A premium, mobile-optimized AI-powered DJ interface.

## Deployment to Vercel

This project is ready to be deployed to Vercel as a Single Page Application (SPA).

### Steps to Deploy

1. **Push to GitHub**: Push your code to a GitHub repository.
2. **Import to Vercel**: Go to [Vercel](https://vercel.com) and import your repository.
3. **Configure Environment Variables**:
   - In the Vercel project settings, add an environment variable named `GEMINI_API_KEY`.
   - You can get your Gemini API key from the [Google AI Studio](https://aistudio.google.com/app/apikey).
4. **Deploy**: Vercel will automatically detect the Vite build settings and deploy your app.

### Build Configuration

- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

## Features

- **AI-Powered Prompt Morphing**: Use the Gemini API to morph between different musical prompts.
- **MIDI Support**: Connect your MIDI controller to map physical knobs to prompt weights.
- **Mobile Optimized**: A premium, hardware-inspired UI that works beautifully on mobile and desktop.
- **Real-time Visualization**: Track your prompt weights over time with a high-performance canvas graph.
