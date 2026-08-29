import React, { useState } from 'react';
import { X, ShieldAlert, Code2, GitMerge } from 'lucide-react';

export default function AddLogModal({ isOpen, onClose, onSave }) {
  const [projectName, setProjectName] = useState('');
  const [repository, setRepository] = useState('micheledallida-web/');
  const [branch, setBranch] = useState('main');
  const [status, setStatus] = useState('active_development');
  const [description, setDescription] = useState('');
  const [techStack, setTechStack] = useState('');
  const [issue, setIssue] = useState('');
  const [resolution, setResolution] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!projectName || !repository || !issue || !resolution) {
      alert('Please fill out the required fields!');
      return;
    }

    const newProject = {
      id: `project-${Date.now()}`,
      project_name: projectName,
      repository,
      branch,
      status,
      description,
      tech_stack: techStack.split(',').map(s => s.trim()).filter(Boolean),
      latest_activity: {
        timestamp: new Date().toISOString(),
        type: 'custom_troubleshooting',
        issue,
        resolution_provided: resolution,
        status: 'unresolved' // Starts as unresolved to allow user to simulate fixing it
      }
    };

    onSave(newProject);
    onClose();
    // Reset
    setProjectName('');
    setRepository('micheledallida-web/');
    setBranch('main');
    setStatus('active_development');
    setDescription('');
    setTechStack('');
    setIssue('');
    setResolution('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/80 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/50">
          <div className="flex items-center space-x-2">
            <Code2 className="w-5 h-5 text-indigo-400" />
            <h3 className="text-white font-bold text-base">Record New Project & Issue Log</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          
          {/* Name & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Project Name *</label>
              <input 
                type="text"
                required
                placeholder="e.g. Quickstark.Ai"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="active_development">Active Dev</option>
                <option value="shipped">Shipped</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          {/* Repo & Branch */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">GitHub Repository *</label>
              <input 
                type="text"
                required
                placeholder="e.g. micheledallida-web/V10"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Default Branch</label>
              <input 
                type="text"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Description & Tech Stack */}
          <div>
            <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Brief Description</label>
            <textarea 
              placeholder="What does this repository/project do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="2"
              className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Tech Stack (comma-separated)</label>
            <input 
              type="text"
              placeholder="Next.js, Vercel, TailwindCSS"
              value={techStack}
              onChange={(e) => setTechStack(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Troubleshooting Info */}
          <div className="pt-3 border-t border-gray-850 space-y-3">
            <span className="text-xs font-semibold font-mono text-amber-400 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> Log Incident / Vercel Build Error
            </span>
            
            <div>
              <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Troubleshooting Issue *</label>
              <textarea 
                required
                placeholder="e.g. Vercel framework auto-detection failed to identify Next.js despite package.json residing in the repository root directory."
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                rows="2"
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 font-mono uppercase mb-1">Resolution / Fix Protocol *</label>
              <textarea 
                required
                placeholder="e.g. Instructed manual override of the Framework Preset to Next.js within Vercel project build settings."
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows="2"
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-850">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-950 border border-gray-800 hover:bg-gray-800 rounded-lg text-xs text-gray-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold rounded-lg text-xs transition"
            >
              Create Log & Project
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}