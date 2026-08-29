'use client';

import { useState } from 'react';
import { useEditorContext } from '@/context/editor-context';
import { useAiStream } from '@/hooks/use-ai-stream';

type PanelAiProps = {
  streamEndpoint?: string;
};

export function PanelAi({ streamEndpoint = '/api/ai/stream' }: PanelAiProps) {
  const [prompt, setPrompt] = useState('Generate a polished landing page hero for a new AI product.');
  const { generatedCode, setGeneratedCode, setGeneratedHtml, setIsStreaming } = useEditorContext();
  const { start, stop, output, error, isStreaming } = useAiStream();

  const handleGenerate = async () => {
    setIsStreaming(true);
    setGeneratedCode('');

    await start({
      endpoint: streamEndpoint,
      payload: { prompt },
      onChunk: (chunk) => {
        // Data flow: panel-ai -> use-ai-stream -> editor-context -> canvas iframe.
        setGeneratedCode((previous) => `${previous}${chunk}`);
      },
      onComplete: (fullText) => {
        setGeneratedHtml(`<main style="padding: 32px; font-family: Arial, sans-serif;">${fullText}</main>`);
        setIsStreaming(false);
      },
    });
  };

  return (
    <section className="flex h-full flex-col gap-4 rounded-3xl border border-line/10 bg-layer/5 p-5">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">AI panel</p>
        <h2 className="mt-2 text-xl font-semibold text-ink">Prompt and stream output</h2>
      </div>
      <label className="flex flex-1 flex-col gap-2 text-sm text-slate-200">
        <span>Prompt</span>
        <textarea className="min-h-36 flex-1 rounded-2xl border border-line/10 bg-slate-950/70 px-4 py-3" onChange={(event) => setPrompt(event.target.value)} value={prompt} />
      </label>
      <div className="flex gap-3">
        <button className="rounded-xl bg-sky-400 px-4 py-3 font-medium text-slate-950" onClick={handleGenerate} type="button">
          {isStreaming ? 'Streaming...' : 'Generate'}
        </button>
        <button className="rounded-xl border border-line/10 px-4 py-3 text-ink" onClick={() => {
          stop();
          setIsStreaming(false);
        }} type="button">
          Stop
        </button>
      </div>
      <div className="rounded-2xl border border-line/10 bg-slate-950/70 p-4 text-sm text-slate-300">
        <p className="mb-2 text-xs uppercase tracking-[0.25em] text-slate-500">Latest code buffer</p>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap">{output || generatedCode}</pre>
        {error ? <p className="mt-3 text-rose-300">TODO: connect a valid streaming endpoint. {error}</p> : null}
      </div>
    </section>
  );
}
