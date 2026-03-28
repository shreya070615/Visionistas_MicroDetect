import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const upload = multer({ storage: multer.memoryStore() });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/analyze", upload.single('image'), async (req: any, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const base64Image = file.buffer.toString('base64');

      // 1. AI Analysis for Morphology and Risk
      const model = "gemini-3-flash-preview";
      const prompt = `Analyze this microscopic image of microplastic particles. 
      Identify the particles and for the most prominent one:
      1. Classify morphology: Fiber, Fragment, or Film.
      2. Estimate Feret Diameter (longest dimension) in micrometers (μm).
      3. Estimate Martin's Diameter (bisecting length) in micrometers (μm).
      4. Calculate Risk Score (0-100) based on morphology and size.
      5. Provide a brief description.
      
      Return JSON format.`;

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: file.mimetype, data: base64Image } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              morphology: { type: Type.STRING, enum: ["Fiber", "Fragment", "Film"] },
              feretDiameter: { type: Type.NUMBER },
              martinDiameter: { type: Type.NUMBER },
              riskScore: { type: Type.NUMBER },
              description: { type: Type.STRING },
              threatLevel: { type: Type.STRING, enum: ["Low", "Medium", "High"] }
            },
            required: ["morphology", "feretDiameter", "martinDiameter", "riskScore", "description", "threatLevel"]
          }
        }
      });

      const result = JSON.parse(response.text);
      
      // Refine Risk Score Calculation
      // Morphology: Fiber (1.0), Fragment (0.7), Film (0.5)
      // Size: Smaller is higher risk. Max size considered 1000um.
      const morphologyWeight = result.morphology === 'Fiber' ? 1.0 : result.morphology === 'Fragment' ? 0.7 : 0.5;
      const sizeFactor = Math.max(0, 1 - (result.feretDiameter / 1000));
      const calculatedRisk = Math.min(100, Math.round((morphologyWeight * 60) + (sizeFactor * 40)));
      
      result.riskScore = calculatedRisk;
      
      // Calculate Elongation Ratio
      const elongationRatio = result.feretDiameter / result.martinDiameter;

      // Simulate Blockchain Hash
      const hash = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      res.json({
        ...result,
        elongationRatio,
        hash,
        timestamp: new Date().toISOString(),
        imageUrl: `data:${file.mimetype};base64,${base64Image}`
      });
    } catch (error) {
      console.error("Analysis Error:", error);
      res.status(500).json({ error: "Failed to analyze image" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
