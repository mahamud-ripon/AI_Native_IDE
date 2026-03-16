# IDE Generator - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/generator/`  
> **Tech Stack:** React + SSE + Framer Motion + D3.js

---

## 1. Executive Summary

The Generator component provides the cinematic loading screen between typing "Build a blog" and landing in a fully-coded IDE. It shows AI generation progress with SSE streaming and DAG visualization.

---

## 2. Generator Hook

### 2.1 useGenerator (src/generator/useGenerator.ts)

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';

interface GenerationStep {
  step: number;
  agent: string;
  message: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface GenerationState {
  conversationId: string | null;
  steps: GenerationStep[];
  currentStep: number;
  isComplete: boolean;
  error: string | null;
}

export function useGenerator() {
  const [state, setState] = useState<GenerationState>({
    conversationId: null,
    steps: [],
    currentStep: 0,
    isComplete: false,
    error: null
  });

  const startGeneration = useCallback(async (prompt: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/ai/generate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      }
    );

    const data = await response.json();
    setState(s => ({ ...s, conversationId: data.conversationId }));
    
    return data.conversationId;
  }, []);

  const subscribeToProgress = useCallback((conversationId: string) => {
    const eventSource = new EventSource(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/ai/generate/${conversationId}/progress`
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'step_update') {
        setState(s => ({
          ...s,
          steps: updateStep(s.steps, data),
          currentStep: data.step
        }));
      } else if (data.type === 'COMPLETE') {
        setState(s => ({ ...s, isComplete: true }));
        eventSource.close();
      } else if (data.type === 'ERROR') {
        setState(s => ({ ...s, error: data.message }));
        eventSource.close();
      }
    };

    return eventSource;
  }, []);

  return { state, startGeneration, subscribeToProgress };
}

function updateStep(steps: GenerationStep[], data: any): GenerationStep[] {
  const existing = steps.find(s => s.agent === data.agent);
  if (existing) {
    return steps.map(s => s.agent === data.agent ? { ...s, message: data.message, status: data.status } : s);
  }
  return [...steps, { step: data.step, agent: data.agent, message: data.message, status: data.status }];
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Generator Screen

### 3.1 GeneratorScreen (src/generator/GeneratorScreen.tsx)

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Circle, Loader2 } from 'lucide-react';
import { useGenerator } from './useGenerator';
import { DagViewer } from '@/visualization/DagViewer';

interface GeneratorScreenProps {
  prompt: string;
  onComplete?: (projectId: string) => void;
}

const DEFAULT_STEPS = [
  { agent: 'architect', label: 'Architect Planning', status: 'pending' },
  { agent: 'backend', label: 'Setting up Database', status: 'pending' },
  { agent: 'frontend', label: 'Writing React Components', status: 'pending' },
  { agent: 'devops', label: 'Installing Dependencies', status: 'pending' }
];

export function GeneratorScreen({ prompt, onComplete }: GeneratorScreenProps) {
  const { state, startGeneration, subscribeToProgress } = useGenerator();
  const [showConfetti, setShowConfetti] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const conversationId = startGeneration(prompt);
    const eventSource = subscribeToProgress(conversationId as string);
    return () => eventSource.close();
  }, [prompt]);

  useEffect(() => {
    if (state.isComplete) {
      setShowConfetti(true);
      setTimeout(() => {
        onComplete?.(state.conversationId!);
        router.push(`/ide/${state.conversationId}`);
      }, 1500);
    }
  }, [state.isComplete]);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-8">
      {/* Title */}
      <motion.h1 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl font-bold text-white mb-2"
      >
        Building your app
      </motion.h1>
      <p className="text-gray-400 mb-8">{prompt}</p>

      {/* Steps */}
      <div className="w-full max-w-md mb-8">
        {DEFAULT_STEPS.map((step, index) => {
          const currentStep = state.steps.find(s => s.agent === step.agent);
          const isActive = currentStep?.status === 'running';
          const isComplete = currentStep?.status === 'completed';
          
          return (
            <motion.div 
              key={step.agent}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center gap-3 py-3"
            >
              {isComplete ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : isActive ? (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              ) : (
                <Circle className="w-5 h-5 text-gray-600" />
              )}
              <span className={isComplete ? 'text-green-500' : isActive ? 'text-white' : 'text-gray-500'}>
                {step.label}
              </span>
              {isActive && currentStep && (
                <span className="text-xs text-gray-400 ml-auto">
                  {currentStep.message}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* DAG Visualization */}
      <div className="w-full max-w-2xl h-64">
        <DagViewer 
          nodes={state.steps.map((s, i) => ({
            id: s.agent,
            label: s.agent,
            status: s.status as any
          }))}
          edges={[
            { source: 'architect', target: 'backend' },
            { source: 'architect', target: 'frontend' },
            { source: 'backend', target: 'devops' },
            { source: 'frontend', target: 'devops' }
          ]}
        />
      </div>

      {/* Success Animation */}
      <AnimatePresence>
        {state.isComplete && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-green-500 text-white px-8 py-4 rounded-lg text-xl font-bold"
            >
              🎉 Ready!
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| useGenerator Hook | ✅ Complete |
| Generator Screen | ✅ Complete |
| SSE Progress | ✅ Complete |
| DAG Visualization | ✅ Complete |
| Success Animation | ✅ Complete |
