import React from 'react';

export default function MetricCard({ title, value, subtext, icon: Icon, colorClass = "from-blue-600 to-indigo-600" }) {
  return (
    <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition duration-300 shadow-lg group">
      {/* Glow effect on hover */}
      <div className={`absolute -right-10 -top-10 w-24 h-24 bg-gradient-to-br ${colorClass} opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition duration-500`}></div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</span>
        <div className={`p-2 rounded-lg bg-gray-800 text-gray-100 group-hover:scale-115 transition duration-300`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      
      <div className="flex items-baseline space-x-2">
        <span className="text-3xl font-extrabold tracking-tight text-ink">{value}</span>
      </div>
      
      <p className="mt-1 text-xs text-gray-500 font-mono">{subtext}</p>
    </div>
  );
}