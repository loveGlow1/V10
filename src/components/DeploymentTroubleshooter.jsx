import React, { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, AlertTriangle, CheckCircle, RefreshCw, Terminal, Sliders, Server, Cpu, Layers } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function DeploymentTroubleshooter({ activeProject, onResolveIssue }) {
  const [simulationStep, setSimulationStep] = useState('idle'); // 'idle' | 'running_failed' | 'failed' | 'fixing' | 'running_fixed' | 'success'
  const [frameworkPreset, setFrameworkPreset] = useState('auto'); // 'auto' | 'nextjs'
  const [rootDir, setRootDir] = useState('./');
  const [terminalLogs, setTerminalLogs] = useState([]);
  const terminalEndRef = useRef(null);

  // Scroll terminal logs
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  const addLog = (text, type = 'info', delay = 0) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const timestamp = new Date().toISOString().split('T')[1].substring(0, 8);
        setTerminalLogs(prev => [...prev, { text: `[${timestamp}] ${text}`, type }]);
        resolve();
      }, delay);
    });
  };

  const runDiagnostic = async () => {
    setSimulationStep('running_failed');
    setTerminalLogs([]);
    
    await addLog("⚡ Initializing Vercel Build pipeline...", 'info', 100);
    await addLog(`📂 Cloning repository: https://github.com/${activeProject.repository}.git`, 'info', 400);
    await addLog(`🌿 Checked out branch: ${activeProject.branch}`, 'info', 300);
    await addLog("🔍 Detecting frameworks in root directory './' ...", 'info', 600);
    await addLog("⚠️  Warning: Multiple config parameters found but package.json detection failed to automatically match standard presets.", 'warning', 800);
    await addLog("🚨 Error: Could not automatically detect a framework. Please configure it manually in your project settings.", 'error', 700);
    await addLog("❌ Deployment failed. Status: error-auto-detect-failed", 'error', 300);
    
    setSimulationStep('failed');
  };

  const applyOverrideAndDeploy = async () => {
    if (frameworkPreset !== 'nextjs') {
      alert("Please select 'Next.js' as your Framework Preset Override first to resolve the issue!");
      return;
    }
    
    setSimulationStep('running_fixed');
    await addLog("⚙️ Applying custom project parameters configuration overrides...", 'warning', 200);
    await addLog(`🔧 Framework Override set manually to: Next.js`, 'success', 400);
    await addLog(`📂 Root directory directory declared as: "${rootDir}"`, 'info', 300);
    await addLog("⚡ Restarting deployment runner with overrides...", 'info', 500);
    await addLog("📦 Installing project dependencies via pnpm (using cached lockfile)...", 'info', 600);
    await addLog("✨ Dependencies resolved successfully in 2.14s.", 'success', 300);
    await addLog("🏗️ Running next build...", 'info', 500);
    await addLog("   - Route (app)             Size     First Load JS", 'info', 100);
    await addLog("   - /                         8.21 kB         84.2 kB", 'info', 100);
    await addLog("   - /api/generate             1.2 kB          77.1 kB", 'info', 100);
    await addLog("✅ Production build successfully optimized.", 'success', 600);
    await addLog("🚀 Uploading build artifacts to Edge Network...", 'info', 400);
    await addLog("🎉 Deployment completed! Status: Ready", 'success', 500);
    await addLog(`🌐 Production URL: https://${activeProject.project_name.toLowerCase().replace('.', '-')}.vercel.app`, 'success', 200);

    setSimulationStep('success');
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.8 },
      colors: ['#0070f3', '#10b981', '#3b82f6']
    });
    
    // Update parent state
    if (onResolveIssue) {
      onResolveIssue(activeProject.id);
    }
  };

  const resetSimulator = () => {
    setSimulationStep('idle');
    setFrameworkPreset('auto');
    setRootDir('./');
    setTerminalLogs([]);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full">
      
      {/* Header */}
      <div className="bg-gray-950 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex space-x-1.5">
            <span className="w-3 h-3 bg-red-500 rounded-full inline-block"></span>
            <span className="w-3 h-3 bg-yellow-500 rounded-full inline-block"></span>
            <span className="w-3 h-3 bg-green-500 rounded-full inline-block"></span>
          </div>
          <span className="text-sm font-semibold font-mono text-gray-400">Vercel-Deployment-Sim_v1.2</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950/80 text-indigo-400 border border-indigo-900/50">
            Project: {activeProject.project_name}
          </span>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-[500px]">
        
        {/* Settings and Actions Config Panel */}
        <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div>
              <h4 className="text-ink font-semibold text-sm flex items-center mb-1">
                <Sliders className="w-4 h-4 mr-2 text-indigo-400" /> Build Configuration Settings
              </h4>
              <p className="text-xs text-gray-400">Simulate or fix settings for Vercel deployment.</p>
            </div>

            {/* Preset field */}
            <div className="space-y-1">
              <label className="text-xs font-mono text-gray-300 block">Framework Preset</label>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setFrameworkPreset('auto')}
                  disabled={simulationStep === 'running_failed' || simulationStep === 'running_fixed'}
                  className={`px-3 py-2 text-xs rounded-lg border font-mono transition text-left flex justify-between items-center ${
                    frameworkPreset === 'auto'
                      ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200'
                      : 'border-gray-800 bg-gray-950 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <span>Automatic</span>
                  <span className="text-[9px] px-1 bg-gray-800 text-gray-400 rounded">Default</span>
                </button>
                
                <button 
                  onClick={() => setFrameworkPreset('nextjs')}
                  disabled={simulationStep === 'running_failed' || simulationStep === 'running_fixed'}
                  className={`px-3 py-2 text-xs rounded-lg border font-mono transition text-left flex justify-between items-center ${
                    frameworkPreset === 'nextjs'
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                      : 'border-gray-800 bg-gray-950 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <span>Next.js</span>
                  <span className="text-[9px] px-1 bg-emerald-900 text-emerald-300 rounded">Override</span>
                </button>
              </div>
            </div>

            {/* Root Directory Field */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-mono text-gray-300 block">Root Directory</label>
                <span className="text-[10px] text-gray-500 font-mono">Contains package.json</span>
              </div>
              <div className="relative">
                <input 
                  type="text"
                  value={rootDir}
                  onChange={(e) => setRootDir(e.target.value)}
                  disabled={simulationStep === 'running_failed' || simulationStep === 'running_fixed'}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 pl-8 text-xs font-mono text-ink focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <Server className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-500" />
              </div>
            </div>

            {/* Explanation box based on simulation state */}
            <div className="p-3 bg-gray-950 border border-gray-850 rounded-lg font-mono text-[11px] space-y-2">
              <div className="text-gray-400 uppercase tracking-wider text-[10px] border-b border-gray-800 pb-1 font-bold">Diagnostic Hub Notes:</div>
              {simulationStep === 'idle' && (
                <p className="text-gray-400">
                  Ready to trace the deployment error for <span className="text-indigo-400">{activeProject.project_name}</span>. Start diagnostic tool build run below.
                </p>
              )}
              {simulationStep === 'running_failed' && (
                <p className="text-yellow-400 animate-pulse-slow">
                  Executing automated Vercel builder sequence... Analysing system config parameters.
                </p>
              )}
              {simulationStep === 'failed' && (
                <div className="space-y-1">
                  <p className="text-red-400 font-semibold flex items-center">
                    <AlertTriangle className="w-3 h-3 mr-1 shrink-0" /> Auto-detection failure detected.
                  </p>
                  <p className="text-gray-400 text-[10px]">
                    The repository contains a valid package.json but Vercel's automated system failed to assign Next.js build templates automatically.
                  </p>
                  <p className="text-emerald-400 font-semibold">
                    💡 Fix: Switch Framework Preset to 'Next.js' above & apply override.
                  </p>
                </div>
              )}
              {simulationStep === 'running_fixed' && (
                <p className="text-emerald-400 animate-pulse-slow">
                  Applying manual override parameters & firing remote edge containers...
                </p>
              )}
              {simulationStep === 'success' && (
                <div className="space-y-1 text-emerald-400">
                  <p className="font-semibold flex items-center">
                    <CheckCircle className="w-3.5 h-3.5 mr-1 shrink-0" /> System Live!
                  </p>
                  <p className="text-gray-300 text-[10px]">
                    Framework explicitly configured as <span className="underline">Next.js</span>. Vercel build executed with exit code 0.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Main Simulation Control Actions */}
          <div className="space-y-2 pt-4 border-t border-gray-850">
            {simulationStep === 'idle' && (
              <button
                onClick={runDiagnostic}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold tracking-wide transition duration-150"
              >
                <Play className="w-4 h-4" />
                <span>Run Deployment Diagnostic</span>
              </button>
            )}

            {simulationStep === 'failed' && (
              <button
                onClick={applyOverrideAndDeploy}
                className={`w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg text-xs font-semibold tracking-wide transition duration-150 ${
                  frameworkPreset === 'nextjs'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-ink cursor-pointer'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                <span>Apply Fix & Re-Deploy</span>
              </button>
            )}

            {(simulationStep === 'running_failed' || simulationStep === 'running_fixed') && (
              <button
                disabled
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-gray-850 text-gray-400 rounded-lg text-xs font-semibold cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Compiling Deployment...</span>
              </button>
            )}

            {simulationStep === 'success' && (
              <button
                onClick={resetSimulator}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold transition duration-150"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset Deployment Simulator</span>
              </button>
            )}
            
            {simulationStep === 'failed' && (
              <button
                onClick={resetSimulator}
                className="w-full py-1 text-center font-mono text-[10px] text-gray-500 hover:text-gray-300 transition"
              >
                Cancel test run
              </button>
            )}
          </div>
        </div>

        {/* Live Terminal Log screen */}
        <div className="lg:col-span-7 flex flex-col bg-gray-950 border border-gray-850 rounded-xl overflow-hidden">
          <div className="bg-gray-900 px-4 py-2 flex items-center justify-between border-b border-gray-950">
            <div className="flex items-center space-x-2">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-mono font-semibold text-gray-400">Terminal Console Output</span>
            </div>
            <div className="flex space-x-1">
              <span className="w-2 h-2 rounded-full bg-gray-700 inline-block"></span>
              <span className="w-2 h-2 rounded-full bg-gray-700 inline-block"></span>
            </div>
          </div>
          
          <div className="p-4 flex-1 font-mono text-xs overflow-y-auto max-h-[360px] min-h-[280px] bg-gray-950 text-gray-300 space-y-1.5 scrollbar-thin select-all">
            {terminalLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-600 text-center space-y-2 py-10">
                <Cpu className="w-8 h-8 opacity-40 animate-pulse-slow" />
                <p className="text-xs">Ready for simulation. Click "Run Deployment Diagnostic" to initialize builder telemetry logs.</p>
              </div>
            ) : (
              terminalLogs.map((log, index) => {
                let textClass = 'text-gray-300';
                if (log.type === 'error') textClass = 'text-red-400 font-semibold';
                if (log.type === 'warning') textClass = 'text-yellow-400';
                if (log.type === 'success') textClass = 'text-emerald-400 font-semibold';
                
                return (
                  <div key={index} className={`whitespace-pre-wrap leading-relaxed ${textClass}`}>
                    {log.text}
                  </div>
                );
              })
            )}
            <div ref={terminalEndRef} />
          </div>
          
          {/* Terminal Footer status */}
          <div className="bg-gray-900 border-t border-gray-950 px-4 py-2 flex justify-between items-center text-[10px] font-mono text-gray-500">
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${
                simulationStep === 'success' ? 'bg-emerald-400' : simulationStep === 'failed' ? 'bg-red-400' : 'bg-gray-600'
              }`} />
              Status: {simulationStep.toUpperCase()}
            </span>
            <span>Encoding: UTF-8</span>
          </div>
        </div>

      </div>
    </div>
  );
}