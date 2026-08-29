'use client';

import React from 'react';
import type { PlanetConfig, StarSystem, SpaceStationAssembly } from '../lib/supabase-types';
import { Shield, Sparkles, Zap, HeartHandshake, Compass, Thermometer } from 'lucide-react';

interface TelemetryPanelProps {
  activePlanet: PlanetConfig | null;
  starSystem: StarSystem;
  station: SpaceStationAssembly;
}

export default function TelemetryPanel({ activePlanet, starSystem, station }: TelemetryPanelProps) {
  // Estimate planetary surface temperature dynamically based on star type and distance
  const calculateTemp = (planet: PlanetConfig) => {
    const baseTempMap = {
      yellow_dwarf: 280, // Earth-like star
      blue_giant: 650,   // Ultra-hot
      red_dwarf: 140,    // Cool stellar
      neutron: 40        // Faint radiation heat
    };
    const base = baseTempMap[starSystem.starType] || 280;
    const distFactor = 25 / planet.distance;
    const rawTemp = base * Math.sqrt(distFactor) - 273; // In Celcius
    return Math.round(rawTemp);
  };

  // Calculate habitability rating dynamically
  const calculateHabitability = (planet: PlanetConfig) => {
    if (planet.type === 'lava') return { score: 1, desc: 'Lethal: molten oceans' };
    if (planet.type === 'gas_giant') return { score: 0, desc: 'Zero: No physical surface' };
    
    const temp = calculateTemp(planet);
    if (planet.type === 'earth' && temp > -15 && temp < 45) {
      return { score: 98, desc: 'Pristine: Perfect atmosphere' };
    }
    if (planet.type === 'ice' && temp < -60) {
      return { score: 12, desc: 'Subzero: Liquid subsurface possible' };
    }
    if (temp > -40 && temp < 85) {
      return { score: 55, desc: 'Viable: Colonization potential' };
    }
    return { score: 4, desc: 'Atmosphere pressure hazardous' };
  };

  const temp = activePlanet ? calculateTemp(activePlanet) : null;
  const habInfo = activePlanet ? calculateHabitability(activePlanet) : null;

  return (
    <div className="bg-space-800 border border-space-accent/20 rounded-xl p-4 shadow-neon-blue/10">
      <div className="flex items-center gap-1.5 border-b border-space-accent/20 pb-2 mb-3.5">
        <Compass className="w-4 h-4 text-space-accent animate-pulse" />
        <h3 className="text-xs font-mono font-bold tracking-widest text-ink uppercase">
          COSMIC TELEMETRY ANALYZER
        </h3>
      </div>

      {activePlanet ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-mono text-gray-400">SELECTED CELESTIAL BODY</span>
              <span className="text-lg font-mono font-bold text-space-accent uppercase">{activePlanet.name}</span>
            </div>
            <div className="bg-space-900 px-3 py-1.5 border border-space-accent/30 rounded text-right">
              <span className="block text-[9px] font-mono text-gray-500">KEPLER COORD</span>
              <span className="text-xs font-mono text-space-accent">SEC-890A-F{activePlanet.distance}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Stats grid box 1 */}
            <div className="bg-space-900/60 p-2.5 rounded border border-gray-800">
              <span className="block text-[9px] font-mono text-gray-400 uppercase">Orbital Radius</span>
              <span className="text-sm font-mono font-bold text-ink">{activePlanet.distance} AU</span>
              <span className="block text-[8px] text-gray-500 font-mono mt-0.5">{(activePlanet.distance * 149.6).toFixed(0)}m Kilometers</span>
            </div>

            {/* Stats grid box 2 */}
            <div className="bg-space-900/60 p-2.5 rounded border border-gray-800">
              <span className="block text-[9px] font-mono text-gray-400 uppercase flex items-center gap-1">
                <Thermometer className="w-3 h-3 text-red-400" />
                Temperature
              </span>
              <span className={`text-sm font-mono font-bold ${temp && temp > 150 ? 'text-red-400' : 'text-blue-300'}`}>
                {temp}°C
              </span>
              <span className="block text-[8px] text-gray-500 font-mono mt-0.5">
                {temp && temp > 0 ? 'Liquid state unlikely' : 'Permafrost layers'}
              </span>
            </div>

            {/* Stats grid box 3 */}
            <div className="bg-space-900/60 p-2.5 rounded border border-gray-800">
              <span className="block text-[9px] font-mono text-gray-400 uppercase">Estimated Mass</span>
              <span className="text-sm font-mono font-bold text-ink">{activePlanet.mass} M⊕</span>
              <span className="block text-[8px] text-gray-500 font-mono mt-0.5">
                {activePlanet.mass > 100 ? 'Supergiant planet' : 'Terrestrial body'}
              </span>
            </div>

            {/* Stats grid box 4 */}
            <div className="bg-space-900/60 p-2.5 rounded border border-gray-800">
              <span className="block text-[9px] font-mono text-gray-400 uppercase">Habitation Index</span>
              <span className="text-sm font-mono font-bold text-space-accent">
                {habInfo?.score}%
              </span>
              <span className="block text-[8px] text-gray-500 font-mono mt-0.5 truncate">
                {habInfo?.desc}
              </span>
            </div>
          </div>

          <div className="bg-space-900/90 p-2.5 rounded border border-space-accent/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[9px] font-mono text-space-accent uppercase">Atmospheric Spectrum Analysis</span>
              <span className="text-xs font-mono text-gray-200">{activePlanet.atmosphere}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-space-accent animate-ping" />
              <span className="text-[9px] font-mono text-space-accent uppercase">Spectroscopy Complete</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 border border-dashed border-gray-800 rounded bg-space-900/50">
          <div className="space-y-1.5 text-center md:text-left">
            <p className="text-xs font-mono text-gray-400">
              System Status: <span className="text-space-accent font-bold">ACTIVE ORBITAL FLIGHT</span>
            </p>
            <p className="text-[11px] text-gray-500 font-mono">
              Click any planetary orbital sphere on the sidebar or 3D map canvas to focus spectrometer diagnostics.
            </p>
          </div>

          <div className="flex gap-4 border-t md:border-t-0 md:border-l border-gray-800 pt-3 md:pt-0 md:pl-6">
            <div className="text-center">
              <span className="block text-[9px] font-mono text-gray-400">ORBITAL PLANETS</span>
              <span className="text-lg font-mono font-bold text-space-accent">{starSystem.planets.length}</span>
            </div>
            <div className="text-center">
              <span className="block text-[9px] font-mono text-gray-400">STATION MODULES</span>
              <span className="text-lg font-mono font-bold text-space-accent">{station.modules.length}</span>
            </div>
            <div className="text-center">
              <span className="block text-[9px] font-mono text-gray-400">STAR TEMPERATURE</span>
              <span className="text-lg font-mono font-bold text-red-400">
                {starSystem.starType === 'blue_giant' ? '55,000K' : starSystem.starType === 'yellow_dwarf' ? '5,778K' : '3,100K'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
