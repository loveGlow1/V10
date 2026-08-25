'use client';

import React, { useState } from 'react';
import type { PlanetConfig, StarSystem } from '../lib/supabase-types';
import { Plus, Trash, Globe, ShieldAlert, Zap, Orbit } from 'lucide-react';

interface SidebarControlsProps {
  activeSystem: StarSystem;
  onUpdateSystem: (system: StarSystem) => void;
  selectedPlanetId: string | null;
  onSelectPlanet: (id: string | null) => void;
}

export default function SidebarControls({
  activeSystem,
  onUpdateSystem,
  selectedPlanetId,
  onSelectPlanet
}: SidebarControlsProps) {
  const [planetName, setPlanetName] = useState('');
  const [planetType, setPlanetType] = useState<PlanetConfig['type']>('earth');
  const [planetSize, setPlanetSize] = useState(1.5);
  const [planetDistance, setPlanetDistance] = useState(25);
  const [planetSpeed, setPlanetSpeed] = useState(0.01);
  const [hasRings, setHasRings] = useState(false);
  const [planetMass, setPlanetMass] = useState(1.0);
  const [moonsCount, setMoonsCount] = useState(0);

  // Add a brand new designed planet to the active sandbox system
  const addPlanet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!planetName.trim()) return;

    const typeColors = {
      earth: '#00f0ff',
      gas_giant: '#bd00ff',
      lava: '#ff3c00',
      ice: '#a2ded0',
      exotic: '#39ff14'
    };

    const newPlanet: PlanetConfig = {
      id: `planet-${Date.now()}`,
      name: planetName,
      type: planetType,
      color: typeColors[planetType],
      size: planetSize,
      distance: planetDistance,
      speed: planetSpeed,
      hasRings: hasRings,
      rotationSpeed: 0.01 + Math.random() * 0.04,
      moonsCount: moonsCount,
      mass: planetMass,
      atmosphere: getAtmosphereType(planetType)
    };

    const updatedPlanets = [...activeSystem.planets, newPlanet];
    onUpdateSystem({
      ...activeSystem,
      planets: updatedPlanets
    });

    // Reset inputs
    setPlanetName('');
    setMoonsCount(0);
  };

  const deletePlanet = (id: string) => {
    const updatedPlanets = activeSystem.planets.filter(p => p.id !== id);
    onUpdateSystem({
      ...activeSystem,
      planets: updatedPlanets
    });
    if (selectedPlanetId === id) {
      onSelectPlanet(null);
    }
  };

  const getAtmosphereType = (type: PlanetConfig['type']) => {
    switch (type) {
      case 'earth': return 'Nitrogen-Oxygen (Ozone Block)';
      case 'gas_giant': return 'Dense Hydrogen-Helium Layers';
      case 'lava': return 'Toxic Sulfur & Carbon Dioxide';
      case 'ice': return 'Supercooled Methane Mist';
      case 'exotic': return 'Superheated Argon-Xenon Plasma';
    }
  };

  return (
    <div className="flex flex-col gap-4 bg-space-800 border border-space-accent/20 rounded-xl p-4 shadow-neon-blue/10 h-full overflow-y-auto max-h-[85vh]">
      
      {/* Celestial Sandbox Title */}
      <div className="border-b border-space-accent/20 pb-3">
        <h2 className="text-xs font-mono font-bold tracking-widest text-space-accent uppercase flex items-center gap-1.5">
          <Orbit className="w-4 h-4 text-space-accent animate-spin" style={{ animationDuration: '6s' }} />
          SYSTEM STAR PARAMETERS
        </h2>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div>
            <label className="block text-[9px] font-mono text-gray-400">STAR SPECTRAL TYPE</label>
            <select
              value={activeSystem.starType}
              onChange={(e) => onUpdateSystem({
                ...activeSystem,
                starType: e.target.value as any,
                starColor: e.target.value === 'yellow_dwarf' ? '#ffd700' : e.target.value === 'blue_giant' ? '#00f0ff' : e.target.value === 'red_dwarf' ? '#ff3c00' : '#ffffff'
              })}
              className="w-full mt-1 bg-space-900 border border-gray-700 rounded text-xs px-2 py-1.5 text-white font-mono outline-none focus-visible:border-space-accent"
            >
              <option value="yellow_dwarf">Yellow Dwarf G-Type</option>
              <option value="blue_giant">Blue Giant O-Type</option>
              <option value="red_dwarf">Red Dwarf M-Type</option>
              <option value="neutron">Neutron Core (Pulsar)</option>
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-mono text-gray-400">STAR DIA. (GM)</label>
            <input
              type="range"
              min="3"
              max="10"
              step="0.5"
              value={activeSystem.starSize}
              onChange={(e) => onUpdateSystem({
                ...activeSystem,
                starSize: parseFloat(e.target.value)
              })}
              className="w-full mt-2 accent-space-accent bg-space-900 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-space-accent mt-0.5">
              <span>MIN</span>
              <span>{activeSystem.starSize} GM</span>
              <span>MAX</span>
            </div>
          </div>
        </div>
      </div>

      {/* Add New Planet Form */}
      <div>
        <h3 className="text-xs font-mono font-bold tracking-widest text-white uppercase mb-2 flex items-center gap-1">
          <Globe className="w-3.5 h-3.5 text-space-accent" />
          FORGE NEW CELESTIAL PLANET
        </h3>
        
        <form onSubmit={addPlanet} className="space-y-3 bg-space-900/60 p-3 rounded-lg border border-space-accent/10">
          <div>
            <label className="block text-[9px] font-mono text-gray-400">PLANET DESIGNATION NAME</label>
            <input
              type="text"
              required
              placeholder="e.g. Cygnus-Prime"
              value={planetName}
              onChange={(e) => setPlanetName(e.target.value)}
              className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none focus-visible:border-space-accent font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-mono text-gray-400">SURFACE CLASSIFICATION</label>
              <select
                value={planetType}
                onChange={(e) => setPlanetType(e.target.value as any)}
                className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none font-mono"
              >
                <option value="earth">Terrestrial Biosphere</option>
                <option value="gas_giant">Gas Giant</option>
                <option value="lava">Lava Magma Core</option>
                <option value="ice">Cryo-Glacial World</option>
                <option value="exotic">Exotic Radiated Crust</option>
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-mono text-gray-400">PLANET RAD (INDEX)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="5.0"
                value={planetSize}
                onChange={(e) => setPlanetSize(parseFloat(e.target.value))}
                className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-mono text-gray-400">DIST FROM STAR (AU)</label>
              <input
                type="number"
                step="2"
                min="8"
                max="70"
                value={planetDistance}
                onChange={(e) => setPlanetDistance(parseInt(e.target.value))}
                className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-[9px] font-mono text-gray-400">ORBITAL SPEED (AU/T)</label>
              <input
                type="number"
                step="0.002"
                min="0.001"
                max="0.08"
                value={planetSpeed}
                onChange={(e) => setPlanetSpeed(parseFloat(e.target.value))}
                className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-mono text-gray-400">MASS (EARTH MASSE(S))</label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                max="400"
                value={planetMass}
                onChange={(e) => setPlanetMass(parseFloat(e.target.value))}
                className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-[9px] font-mono text-gray-400">NATURAL MOONS COUNT</label>
              <select
                value={moonsCount}
                onChange={(e) => setMoonsCount(parseInt(e.target.value))}
                className="w-full mt-1 bg-space-800 text-white border border-gray-700 rounded text-xs px-2 py-1.5 outline-none font-mono"
              >
                <option value={0}>0 Moons</option>
                <option value={1}>1 Moon</option>
                <option value={2}>2 Moons</option>
                <option value={3}>3 Moons</option>
                <option value={4}>4 Moons</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hasRings"
              checked={hasRings}
              onChange={(e) => setHasRings(e.target.checked)}
              className="rounded text-space-accent bg-space-800 border-gray-700 focus-visible:ring-0 w-3.5 h-3.5"
            />
            <label htmlFor="hasRings" className="text-[10px] font-mono text-gray-400 cursor-pointer">
              GENERATE SATURN-LIKE DEBRIS RINGS
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-space-accent hover:bg-space-accent/80 text-space-900 font-bold rounded font-mono text-[11px] flex items-center justify-center gap-1 transition-all duration-300 shadow-neon-blue"
          >
            <Plus className="w-3.5 h-3.5" />
            INITIATE PLANET FORGE PROTOCOL
          </button>
        </form>
      </div>

      {/* Orbit Planets List */}
      <div className="flex-1">
        <h3 className="text-xs font-mono font-bold tracking-widest text-white uppercase mb-2 flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-space-accent" />
          SYSTEM PLANETARY OBJECTS
        </h3>

        <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
          {activeSystem.planets.length === 0 ? (
            <div className="text-center py-4 text-xs font-mono text-gray-500 border border-dashed border-gray-800 rounded">
              No orbital planets mapped in this star system core.
            </div>
          ) : (
            activeSystem.planets.map((p) => (
              <div
                key={p.id}
                onClick={() => onSelectPlanet(p.id === selectedPlanetId ? null : p.id)}
                className={`flex items-center justify-between p-2 rounded cursor-pointer border transition-all duration-300 ${
                  p.id === selectedPlanetId
                    ? 'bg-space-accent/20 border-space-accent shadow-neon-blue' 
                    : 'bg-space-900/60 border-gray-800 text-gray-300 hover:border-gray-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span 
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-mono font-semibold">{p.name}</span>
                    <span className="text-[8px] text-gray-400 font-mono uppercase">{p.type.replace('_', ' ')} • {p.distance} AU</span>
                  </div>
                </div>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePlanet(p.id);
                  }}
                  className="text-gray-500 hover:text-red-400 p-1.5 transition-colors"
                  title="Vaporize Planet"
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
