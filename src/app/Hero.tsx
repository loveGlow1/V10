import React from 'react';
import { ArrowRight, Shield, Cpu, Zap } from 'lucide-react';
import Image from 'next/image';

export function Hero() {
  return (
    <section className="text-center py-20 px-4">
      <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
        Build the Future Faster
      </h1>
      <p className="max-w-2xl mx-auto text-xl text-slate-400 mb-10">
        Deploy production-ready applications with unmatched speed, security, and scalability.
      </p>
      
      {/* Call to Action Button */}
      <div className="flex justify-center gap-4 mb-16">
        <button className="bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 rounded-lg flex items-center gap-2 transition-colors">
          Get Started <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Futuristic Showcase Image Integration */}
      <div className="max-w-5xl mx-auto relative rounded-2xl p-[1px] bg-gradient-to-r from-blue-500/50 via-indigo-500/50 to-purple-500/50 shadow-2xl shadow-indigo-950/50">
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
          <Image
            src="/hero-preview.png"
            alt="QuickStart.Ai Platform Experience"
            fill
            priority
            className="object-cover transform hover:scale-[1.01] transition-transform duration-500"
          />
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="grid md:grid-cols-3 gap-8 py-16 max-w-6xl mx-auto px-4">
      <div className="p-6 bg-slate-800 rounded-xl">
        <Zap className="w-10 h-10 text-indigo-400 mb-4" />
        <h3 className="text-xl font-bold mb-2">Blazing Fast</h3>
        <p className="text-slate-400">Optimized build times and lightning performance.</p>
      </div>
      <div className="p-6 bg-slate-800 rounded-xl">
        <Shield className="w-10 h-10 text-indigo-400 mb-4" />
        <h3 className="text-xl font-bold mb-2">Secure</h3>
        <p className="text-slate-400">Built-in protections against vulnerabilities.</p>
      </div>
      <div className="p-6 bg-slate-800 rounded-xl">
        <Cpu className="w-10 h-10 text-indigo-400 mb-4" />
        <h3 className="text-xl font-bold mb-2">Edge-ready</h3>
        <p className="text-slate-400">Deploy close to your users globally.</p>
      </div>
    </section>
  );
}
