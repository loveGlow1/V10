'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Music, Activity } from 'lucide-react';

export default function AudioSynth() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [synthVolume, setSynthVolume] = useState(30); // scale 0-100
  const audioCtxRef = useRef<AudioContext | null>(null);
  const droneOscRef = useRef<OscillatorNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<any>(null);

  const initAudio = () => {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    audioCtxRef.current = audioCtx;

    // Create deep cosmic ambient drone oscillator
    const drone = audioCtx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.setValueAtTime(55, audioCtx.currentTime); // low A

    const drone2 = audioCtx.createOscillator();
    drone2.type = 'triangle';
    drone2.frequency.setValueAtTime(55.5, audioCtx.currentTime); // detuned

    // High resonant low-pass filter to make it cosmic
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, audioCtx.currentTime);
    filter.Q.setValueAtTime(4, audioCtx.currentTime);

    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(synthVolume / 400, audioCtx.currentTime); // moderate background

    // Chain connections
    drone.connect(filter);
    drone2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    drone.start();
    drone2.start();

    droneOscRef.current = drone;
    filterNodeRef.current = filter;
    gainNodeRef.current = gainNode;

    // Cosmic arpeggiator/beeper simulation interval for futuristic sound effects
    intervalRef.current = setInterval(() => {
      if (Math.random() > 0.4) {
        triggerCosmicPing();
      }
    }, 4000);
  };

  const triggerCosmicPing = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'suspended') return;
    const ctx = audioCtxRef.current;
    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    
    ping.type = Math.random() > 0.5 ? 'sine' : 'triangle';
    
    // Random galactic frequency selection
    const freqs = [440, 523.25, 587.33, 659.25, 783.99, 880];
    const chosenFreq = freqs[Math.floor(Math.random() * freqs.length)] * (Math.random() > 0.7 ? 2 : 1);
    
    ping.frequency.setValueAtTime(chosenFreq, ctx.currentTime);
    ping.frequency.exponentialRampToValueAtTime(chosenFreq / 2, ctx.currentTime + 1.5);
    
    pingGain.gain.setValueAtTime(0.001, ctx.currentTime);
    pingGain.gain.linearRampToValueAtTime((synthVolume / 100) * 0.1, ctx.currentTime + 0.1);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.0);
    
    // Filter
    const pingFilter = ctx.createBiquadFilter();
    pingFilter.type = 'bandpass';
    pingFilter.frequency.setValueAtTime(chosenFreq, ctx.currentTime);
    
    ping.connect(pingFilter);
    pingFilter.connect(pingGain);
    pingGain.connect(ctx.destination);
    
    ping.start();
    ping.stop(ctx.currentTime + 2.2);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    setSynthVolume(vol);
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(vol / 400, audioCtxRef.current.currentTime);
    }
  };

  const toggleSound = async () => {
    if (!isPlaying) {
      if (!audioCtxRef.current) {
        initAudio();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      setIsPlaying(true);
    } else {
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        await audioCtxRef.current.suspend();
      }
      setIsPlaying(false);
    }
  };

  // Dynamically change filter frequency occasionally to simulate orbit
  useEffect(() => {
    let count = 0;
    const filterInterval = setInterval(() => {
      if (filterNodeRef.current && audioCtxRef.current) {
        const baseFreq = 160 + Math.sin(count) * 80;
        filterNodeRef.current.frequency.setValueAtTime(baseFreq, audioCtxRef.current.currentTime);
        count += 0.1;
      }
    }, 200);
    
    return () => {
      clearInterval(filterInterval);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="flex items-center gap-3 bg-space-800 border border-space-accent/30 rounded-lg p-2.5 shadow-neon-blue/20">
      <button
        onClick={toggleSound}
        className={`p-2 rounded-md border flex items-center justify-center transition-all duration-300 ${
          isPlaying 
            ? 'bg-space-accent/20 border-space-accent text-space-accent animate-pulse shadow-neon-blue'
            : 'bg-space-900 border-gray-700 text-gray-400 hover:text-ink'
        }`}
        title={isPlaying ? 'Mute Ambient Space Synth' : 'Enable Space Synth'}
      >
        {isPlaying ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] tracking-wider uppercase text-space-accent flex items-center gap-1.5 font-mono">
          <Activity className="w-3 h-3 text-space-accent animate-ping" />
          Space Synth Engine
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 font-mono">VOL</span>
          <input
            type="range"
            min="0"
            max="100"
            value={synthVolume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-space-900 rounded-lg appearance-none cursor-pointer accent-space-accent outline-none"
          />
          <span className="text-[9px] text-space-accent font-mono">{synthVolume}%</span>
        </div>
      </div>
    </div>
  );
}
