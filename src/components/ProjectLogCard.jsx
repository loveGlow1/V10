import React from 'react';
import { Github, GitBranch, Terminal, CheckCircle2, AlertTriangle, Play, HelpCircle } from 'lucide-react';

export default function ProjectLogCard({ project, onSelect, isActive }) {
  const isResolved = project.latest_activity?.status === 'resolved';
  
  const statusColors = {
    active_development: 'bg-indigo-950/60 border-indigo-500/40 text-indigo-300 text-indigo-400',
    shipped: 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 text-emerald-400',
    paused: 'bg-amber-950/60 border-amber-500/40 text-amber-300 text-amber-400'
  };

  const statusLabel = {
    active_development: 'Active Dev',
    shipped: 'Shipped',
    paused: 'Paused'
  };

  return (
    <div 
      onClick={() => onSelect(project)}
      className={`cursor-pointer transition duration-200 border rounded-xl overflow-hidden flex flex-col justify-between ${
        isActive 
          ? 'bg-gray-900/90 border-indigo-500 shadow-lg shadow-indigo-950/30 ring-1 ring-indigo-500/20' 
          : 'bg-gray-900/40 border-gray-800 hover:bg-gray-900/60 hover:border-gray-700'
      }`}
    >
      <div className="p-5 space-y-4">
        
        {/* Top bar with Name & Badge */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-white tracking-tight flex items-center space-x-2">
              <span>{project.project_name}</span>
            </h3>
            <span className="text-xs text-gray-500 font-mono flex items-center mt-1">
              <Github className="w-3 h-3 mr-1 inline" />
              {project.repository}
            </span>
          </div>
          
          <div className="flex flex-col items-end space-y-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-medium uppercase tracking-wide border ${statusColors[project.status]}`}>
              {statusLabel[project.status] || project.status}
            </span>
            <span className="text-[10px] text-gray-400 font-mono flex items-center bg-gray-950/80 px-2 py-0.5 rounded border border-gray-850">
              <GitBranch className="w-3 h-3 mr-1 inline text-indigo-400" />
              {project.branch}
            </span>
          </div>
        </div>

        {/* Mini Description */}
        <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed">
          {project.description || "No detailed project description available."}
        </p>

        {/* Tech Stack List */}
        <div className="flex flex-wrap gap-1 pt-1">
          {project.tech_stack?.map((tech) => (
            <span key={tech} className="bg-gray-950 text-gray-400 font-mono text-[10px] px-2 py-0.5 rounded border border-gray-800">
              {tech}
            </span>
          ))}
        </div>

        {/* Incident Alert / Log Preview Box */}
        {project.latest_activity && (
          <div className={`mt-3 p-3 rounded-lg border text-xs font-mono ${
            isResolved 
              ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300'
              : 'bg-amber-950/30 border-amber-900/40 text-amber-300'
          }`}>
            <div className="flex items-center justify-between mb-1.5 border-b border-gray-800/40 pb-1.5">
              <span className="font-semibold flex items-center gap-1.5">
                {isResolved ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                {project.latest_activity.type.replace(/_/g, ' ').toUpperCase()}
              </span>
              <span className="text-[9px] text-gray-400">
                {new Date(project.latest_activity.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-gray-300 text-[11px] line-clamp-1">
                <strong className="text-red-400 font-semibold">Issue:</strong> {project.latest_activity.issue}
              </p>
              <p className="text-gray-400 text-[10px] line-clamp-2">
                <strong className="text-emerald-400 font-semibold">Fix:</strong> {project.latest_activity.resolution_provided}
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Card action banner */}
      <div className={`px-5 py-2.5 bg-gray-900/90 border-t flex items-center justify-between text-[11px] transition duration-150 ${
        isActive 
          ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20' 
          : 'border-gray-800 text-gray-400 hover:text-white'
      }`}>
        <span className="font-mono">Click to inspect / run diagnostics</span>
        <Play className="w-3 h-3 text-indigo-400 group-hover:translate-x-1 transition duration-150" />
      </div>
    </div>
  );
}