import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  app.post('/api/expand', upload.any(), async (req, res) => {
    try {
      const { idea, type, tone, detail } = req.body;
      const files = req.files as Express.Multer.File[];
      
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      // Need to construct the prompt as in expand.js
      const prompt = `Idea: ${idea}\nType: ${type}\nTone: ${tone}\nDetail: ${detail}`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      res.json({ prompt: response.text() });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Generation failed' });
    }
  });

  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on port 3000');
  });
}

startServer();
