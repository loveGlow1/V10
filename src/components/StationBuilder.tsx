'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Shield, BatteryCharging, Power, RotateCw, Sparkles, Milestone } from 'lucide-react';
import type { StationModule } from '../lib/supabase-types';

interface StationBuilderProps {
  modules: StationModule[];
  onUpdateModules: (modules: StationModule[]) => void;
}

export default function StationBuilder({ modules, onUpdateModules }: StationBuilderProps) {
  const [selectedType, setSelectedType] = useState<'solar' | 'habitat' | 'docking' | 'thruster'>('solar');
  const [gridX, setGridX] = useState<number>(0);
  const [gridZ, setGridZ] = useState<number>(3);
  const [rotationAngle, setRotationAngle] = useState<number>(0);

  const addModule = () => {
    // Build unique identifier
    const newId = `mod-${Date.now()}`;
    const newModule: StationModule = {
      id: newId,
      type: selectedType,
      x: gridX,
      y: 0,
      z: gridZ,
      rotation: rotationAngle
    };
    
    // Prevent placing on top of existing modules directly
    const isOverlap = modules.some(m => m.x === gridX && m.z === gridZ);
    if (isOverlap) {
      alert('Warning: Location slot already occupied. Pick distinct orbital coordinates.');
      return;
    }

    onUpdateModules([...modules, newModule]);
  };

  const removeModule = (id: string) => {
    if (id === 'm1') {
      alert("Cannot dismantle the primary Space Station Control Command Module Core!");
      return;
    }
    onUpdateModules(modules.filter(m => m.id !== id));
  };

  return (
    <div className="bg-space-800 border border-space-accent/20 rounded-xl p-4 scanner-line">
      <div className="flex items-center justify-between border-b border-space-accent/20 pb-2 mb-4">
        <h3 className="text-sm font-mono tracking-widest text-space-accent flex items-center gap-2">
          <Shield className="w-4 h-4 text-space-accent animate-pulse" />
          SPACE STATION DRY-DOCK INTEGRATION
        </h3>
        <span className="text-[10px] bg-space-accent/10 border border-space-accent/30 text-space-accent font-mono px-2 py-0.5 rounded">
          MODULAR ASSEMBLY SYSTEM v2.1
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Add components controls */}
        <div className="space-y-3 bg-space-900/80 p-3 rounded-lg border border-space-accent/10">
          <p className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">
            1. Select Component Module Unit:
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSelectedType('solar')}
              className={`p-2 rounded text-left border flex flex-col gap-1 transition-all ${ 
                selectedType === 'solar'
                  ? 'bg-space-accent/10 border-space-accent text-space-accent' 
                  : 'bg-space-800/40 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <BatteryCharging className="w-3.5 h-3.5" />
                Solar Arrays
              </div>
              <span className="text-[9px] text-gray-400">Generates vital megawatt energy.</span>
            </button>

            <button
              onClick={() => setSelectedType('habitat')}
              className={`p-2 rounded text-left border flex flex-col gap-1 transition-all ${ 
                selectedType === 'habitat'
                  ? 'bg-space-accent/10 border-space-accent text-space-accent' 
                  : 'bg-space-800/40 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                Habitation Dome
              </div>
              <span className="text-[9px] text-gray-400">Sustains scientist staff life.</span>
            </button>

            <button
              onClick={() => setSelectedType('docking')}
              className={`p-2 rounded text-left border flex flex-col gap-1 transition-all ${ 
                selectedType === 'docking'
                  ? 'bg-space-accent/10 border-space-accent text-space-accent' 
                  : 'bg-space-800/40 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <Milestone className="w-3.5 h-3.5" />
                Docking Gateway
              </div>
              <span className="text-[9px] text-gray-400">Enables resource shipping vessels.</span>
            </button>

            <button
              onClick={() => setSelectedType('thruster')}
              className={`p-2 rounded text-left border flex flex-col gap-1 transition-all ${ 
                selectedType === 'thruster'
                  ? 'bg-space-accent/10 border-space-accent text-space-accent' 
                  : 'bg-space-800/40 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <Power className="w-3.5 h-3.5" />
                Plasma Thrusters
              </div>
              <span className="text-[9px] text-gray-400">Maintains precise stable orbits.</span>
            </button>
          </div>

          <p className="text-[11px] font-mono text-gray-400 uppercase tracking-wider pt-2">
            2. Space Station Grid Attachment Offset:
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[9px] font-mono text-gray-400">AXIS X (OFFSET)</label>
              <input
                type="number"
                step="1.5"
                value={gridX}
                onChange={e => setGridX(parseFloat(e.target.value))}
                className="w-full bg-space-800 text-white font-mono text-xs rounded border border-gray-700 px-2 py-1 outline-none focus-visible:border-space-accent"
              />
            </div>
            <div>
              <label className="block text-[9px] font-mono text-gray-400">AXIS Z (OFFSET)</label>
              <input
                type="number"
                step="1.5"
                value={gridZ}
                onChange={e => setGridZ(parseFloat(e.target.value))}
                className="w-full bg-space-800 text-white font-mono text-xs rounded border border-gray-700 px-2 py-1 outline-none focus-visible:border-space-accent"
              />
            </div>
            <div>
              <label className="block text-[9px] font-mono text-gray-400">ROTATION (°)</label>
              <select
                value={rotationAngle}
                onChange={e => setRotationAngle(parseInt(e.target.value))}
                className="w-full bg-space-800 text-white font-mono text-xs rounded border border-gray-700 px-2 py-1 outline-none focus-visible:border-space-accent"
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>
          </div>

          <button
            onClick={addModule}
            className="w-full mt-2 py-2 rounded font-mono text-xs bg-space-accent text-space-900 font-bold hover:bg-space-accent/80 flex items-center justify-center gap-1 shadow-neon-blue transition-all duration-300"
          >
            <Plus className="w-4 h-4" />
            LAUNCH MODULE TO STATION COORD
          </button>
        </div>

        {/* Modular elements table list */}
        <div className="bg-space-900/80 p-3 rounded-lg border border-space-accent/10 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-mono text-gray-400 uppercase tracking-wider mb-2">
              Active Station Hull Components Structure:
            </p>
            <div className="max-h-[170px] overflow-y-auto space-y-1.5 pr-1">
              {modules.map((m) => (
                <div 
                  key={m.id} 
                  className="flex items-center justify-between text-xs font-mono bg-space-800 border border-space-accent/10 p-2 rounded hover:border-space-accent/40"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${m.type === 'core' ? 'bg-space-accent animate-ping' : 'bg-gray-400'}`} />
                    <span className="uppercase font-semibold text-[11px]">{m.type}</span>
                    <span className="text-[9px] text-gray-500">({m.x}, {m.z}) • {m.rotation}°</span>
                  </div>
                  {m.type !== 'core' && (
                    <button
                      onClick={() => removeModule(m.id)}
                      className="text-red-400 hover:text-red-600 transition-colors p-1"
                      title="Dismantle module"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-space-accent/10 pt-2.5 mt-2 flex items-center justify-between text-[11px] font-mono text-gray-400">
            <span>Total Structure Mass: <b className="text-space-accent">{(modules.length * 4.8).toFixed(1)} MT</b></span>
            <span>Station Capacity: <b className="text-space-accent">{modules.filter(m => m.type === 'habitat').length * 15 + 10} Scientists</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}
