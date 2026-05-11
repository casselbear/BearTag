/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { 
  Plus, 
  Upload, 
  Link as LinkIcon, 
  X, 
  Tag, 
  Loader2, 
  Check, 
  Copy, 
  AlertCircle,
  Hash,
  ArrowRight
} from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { twMerge } from "tailwind-merge";

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Lazy initialization to prevent top-level crashes if API key is missing
let aiClient: GoogleGenAI | null = null;
function getAI() {
  const key = typeof process !== 'undefined' && process.env.GEMINI_API_KEY 
    ? process.env.GEMINI_API_KEY 
    : undefined;
    
  if (!key || key === "undefined") {
    return null;
  }
  if (!aiClient) {
    try {
      aiClient = new GoogleGenAI({ apiKey: key });
    } catch (e) {
      console.error("Failed to initialize Gemini AI:", e);
      return null;
    }
  }
  return aiClient;
}

interface ImageItem {
  id: string;
  source: string; // Preview URL
  file?: File;    // Original file object
  type: 'file' | 'url';
  name: string;
  status: 'idle' | 'processing' | 'done' | 'error';
  altText?: string;
  error?: string;
}

const MAX_IMAGES = 50;

export default function App() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const processImage = useCallback(async (item: ImageItem) => {
    // Basic guards
    if (item.status === 'processing' || item.status === 'done') return;

    const ai = getAI();
    if (!ai) {
      setItems(prev => prev.map(i => i.id === item.id ? { 
        ...i, 
        status: 'error', 
        error: "API Key missing. Please check your environment variables." 
      } : i));
      return;
    }

    // Set to processing immediately
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'processing' } : i));

    try {
      let base64 = "";
      let mimeType = "image/jpeg";

      if (item.type === 'file' && item.file) {
        mimeType = item.file.type || "image/jpeg";
        base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            resolve(res.split(',')[1]);
          };
          reader.onerror = () => reject(new Error("Failed to read image file"));
          reader.readAsDataURL(item.file!);
        });
      } else {
        // For URLs
        try {
          const response = await fetch(item.source);
          const blob = await response.blob();
          mimeType = blob.type || "image/jpeg";
          base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = reader.result as string;
              resolve(res.split(',')[1]);
            };
            reader.onerror = () => reject(new Error("Failed to read image blob"));
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          throw new Error("CORS blocking URL access. Please upload the file directly.");
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: "Write technical, accurate, and concise alt text for this image. Focus on providing accessibility. Do not include phrases like 'image of'. Just describe the content." },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64
              }
            }
          ]
        }
      });

      const altText = response.text || "No description generated.";

      setItems(prev => prev.map(i => i.id === item.id ? { 
        ...i, 
        status: 'done', 
        altText: altText.trim() 
      } : i));
    } catch (error) {
      console.error("Processing error:", error);
      setItems(prev => prev.map(i => i.id === item.id ? { 
        ...i, 
        status: 'error', 
        error: error instanceof Error ? error.message : "Failed to process image" 
      } : i));
    }
  }, []);

  const handleFiles = useCallback((files: FileList) => {
    const remaining = MAX_IMAGES - items.length;
    if (remaining <= 0) return;

    const newFiles = Array.from(files).slice(0, remaining);
    const newItems: ImageItem[] = newFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      source: URL.createObjectURL(file),
      file: file,
      type: 'file',
      name: file.name,
      status: 'idle',
    }));

    setItems(prev => [...prev, ...newItems]);
  }, [items.length]);

  const handleAddUrl = () => {
    if (!urlInput.trim()) return;
    if (items.length >= MAX_IMAGES) {
      alert(`Maximum of ${MAX_IMAGES} images allowed.`);
      return;
    }

    const newItem: ImageItem = {
      id: Math.random().toString(36).substring(7),
      source: urlInput.trim(),
      type: 'url',
      name: urlInput.split('/').pop() || "Image from URL",
      status: 'idle',
    };

    setItems(prev => [...prev, newItem]);
    setUrlInput("");
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.type === 'file') {
        URL.revokeObjectURL(item.source);
      }
      return prev.filter(i => i.id !== id);
    });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const [isProcessing, setIsProcessing] = useState(false);

  // Sequential processing to avoid rate limiting
  useEffect(() => {
    if (isProcessing) return;

    const idleItem = items.find(i => i.status === 'idle');
    if (idleItem) {
      setIsProcessing(true);
      processImage(idleItem)
        .catch(err => console.error("Effect processing error:", err))
        .finally(() => setIsProcessing(false));
    }
  }, [items, processImage, isProcessing]);

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 lg:p-24 selection:bg-brand selection:text-white">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-brand/5 blur-[100px] rounded-full" />
      </div>

      <div className="relative max-w-[1600px] mx-auto space-y-12">
        {/* Top Header Section */}
        <header className="space-y-8">
          {!process.env.GEMINI_API_KEY && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm max-w-xl"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p>
                <strong>Configuration Required:</strong> GEMINI_API_KEY is not set.
              </p>
            </motion.div>
          )}

          <div className="space-y-4">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-4"
            >
              <div className="relative w-12 h-12 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,169,206,0.3)] border border-white/10">
                <img 
                  src="https://previews.dropbox.com/p/thumb/ADCPoSg_gEqF2-gvK0oNAqsjG8kYukiLuEp7_nrIp3L1eisZGY8BJlVpg1U25RVqTfw8Iu1SZnBSimm3oSP9MCzUC2FaXB-Tedn9QZnh2CxaRlwbK5p_CoDh0Cu4102vuyqqioBlfb8lQkVFvzuRMmsTuBct32pPlaEIXHFJPnl1bBIo4M9TlpNGBBgHGMCTjv46D2VZnv8nM-OYS3rOzmk4CRE7foeG_PeF2lOt1UxnQEW5hiStXTAsrZi-Z7lvoyI2k6Q-SBQQtJONL7D2xc43-C5aKWTSR5CsjA2MXwLWe0CjzRPP0E_I9e9pR0BE0oN-uXLzrp-u5tsyMvkwbXl-/p.png?is_prewarmed=true" 
                  alt="BearTag logo" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
              <h1 className="text-4xl font-extrabold tracking-tighter text-white mb-0 leading-none not-italic">BearTag</h1>
            </motion.div>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-gray-400 text-lg max-w-2xl"
            >
              Batch generate accessible alt text for your images.
            </motion.p>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-16 items-start">
          {/* Left Column: Upload */}
          <div className="lg:col-span-1 lg:sticky lg:top-12 flex flex-col space-y-6">
            <section className="flex flex-col space-y-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className={cn(
                  "glass-card p-10 flex flex-col items-center justify-center border-2 border-dashed transition-all duration-300 relative min-h-[350px]",
                  isDragging ? "border-brand bg-brand/5 scale-[1.01]" : "border-gray-800 hover:border-gray-700",
                  items.length >= MAX_IMAGES && "opacity-50 pointer-events-none"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
                }}
              >
                <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mb-6 border border-gray-800">
                  <Upload className="w-8 h-8 text-brand" />
                </div>
                <div className="text-center space-y-3">
                  <p className="text-xl font-medium">Drag & drop images</p>
                  <p className="text-gray-500 text-sm">or click to browse from your device</p>
                </div>
                <input 
                  type="file" 
                  multiple 
                  accept="image/*"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                  disabled={items.length >= MAX_IMAGES}
                />
                <div className="mt-8 pt-8 border-t border-gray-800 w-full flex flex-col items-center justify-center gap-3">
                  <p className="text-xs text-gray-400 uppercase tracking-widest font-bold flex items-center gap-2">
                    <Hash className="w-3 h-3 text-brand" />
                    {items.length} / {MAX_IMAGES} IMAGES
                  </p>
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-medium">
                    PNG, JPEG, WEBP, HEIC
                  </p>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-4"
              >
                <div className="relative group">
                  <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-brand transition-colors" />
                  <input 
                    type="text" 
                    placeholder="Paste an image URL..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                    className="w-full bg-gray-900/50 border border-gray-800 rounded-xl py-4 pl-12 pr-12 text-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"
                  />
                  {urlInput && (
                    <button 
                      onClick={() => setUrlInput("")}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button 
                  onClick={handleAddUrl}
                  className="w-full bg-brand text-black py-4 rounded-xl font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(0,169,206,0.2)]"
                >
                  Add URL
                  <ArrowRight className="w-5 h-5" />
                </button>
              </motion.div>
            </section>
          </div>

          {/* Right Column: Results Area */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between pb-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Results {items.length > 0 && `(${items.length})`}
              </h2>
              {items.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => {
                    items.forEach(item => {
                      if (item.type === 'file') URL.revokeObjectURL(item.source);
                    });
                    setItems([]);
                  }}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-red-400 transition-colors px-4 py-2 bg-gray-900/50 rounded-lg border border-gray-800"
                >
                  <X className="w-4 h-4" />
                  Clear All
                </motion.button>
              )}
            </div>

            <section className="space-y-6">
              <AnimatePresence mode="popLayout">
                {items.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-[450px] flex flex-col items-center justify-center text-gray-600 border-2 border-dashed border-gray-800 rounded-[32px] bg-gray-900/10"
                  >
                    <div className="w-16 h-16 rounded-full bg-gray-900/50 flex items-center justify-center mb-4 border border-gray-800/50">
                      <Tag className="w-8 h-8 opacity-20" />
                    </div>
                    <p className="text-sm font-medium tracking-wide">Ready for your images</p>
                    <p className="text-xs text-gray-700 mt-2">Alt text will appear here once processed</p>
                  </motion.div>
                ) : (
                  items.map((item, index) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                      className="glass-card overflow-hidden group"
                    >
                      <div className="flex flex-col md:flex-row">
                        {/* Thumbnail */}
                        <div className="w-full md:w-64 h-48 md:h-auto bg-gray-950 flex-shrink-0 relative border-r border-gray-800">
                          <img 
                            src={item.source} 
                            alt="Thumbnail" 
                            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                          />
                          <button 
                            onClick={() => removeItem(item.id)}
                            className="absolute top-3 left-3 p-1.5 bg-black/60 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 text-white"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] font-mono uppercase tracking-wider text-gray-400">
                            #{index + 1}
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 p-6 flex flex-col justify-between space-y-4">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                {item.status === 'processing' && <Loader2 className="w-4 h-4 text-brand animate-spin" />}
                                {item.status === 'done' && <Check className="w-4 h-4 text-emerald-500" />}
                                {item.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                <span className="text-xs font-mono text-gray-500 truncate max-w-[200px]">
                                  {item.name}
                                </span>
                              </div>
                            </div>

                            <div className={cn(
                              "p-4 rounded-2xl font-mono text-sm leading-relaxed min-h-[80px] flex items-center transition-colors",
                              item.status === 'processing' ? "bg-brand/5 border border-brand/20 text-brand/80 italic" : 
                              item.status === 'error' ? "bg-red-500/5 border border-red-500/20 text-red-400" :
                              "bg-black/40 border border-gray-800 text-gray-300 shadow-inner"
                            )}>
                              {item.status === 'processing' && "Analyzing image context..."}
                              {item.status === 'error' && item.error}
                              {item.status === 'done' && item.altText}
                              {item.status === 'idle' && "Waiting to process..."}
                            </div>
                          </div>

                          {item.status === 'done' && (
                            <div className="flex justify-end">
                              <button 
                                onClick={() => copyToClipboard(item.altText || "", item.id)}
                                className={cn(
                                  "flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-lg",
                                  copiedId === item.id 
                                    ? "bg-emerald-500 text-white" 
                                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                                )}
                              >
                                {copiedId === item.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    Copy Alt Text
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

