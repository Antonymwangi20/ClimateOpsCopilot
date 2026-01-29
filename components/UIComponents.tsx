
import React from 'react';
import { motion } from 'framer-motion';
import { Target, Activity, Zap } from 'lucide-react';
import { AgentStatus } from '../types';

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    LOW: 'bg-green-100 text-green-800 border-green-200',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-200',
    CRITICAL: 'bg-red-100 text-red-800 border-red-200 animate-pulse',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-bold border ${colors[status] || 'bg-slate-100'}`}>
      {status} RISK
    </span>
  );
};

export const ConfidenceBadge: React.FC<{ confidence: number }> = ({ confidence }) => {
  let colorClass = 'bg-slate-100 text-slate-600';
  if (confidence >= 80) colorClass = 'bg-blue-100 text-blue-700 border-blue-200';
  else if (confidence >= 50) colorClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
  else colorClass = 'bg-red-100 text-red-700 border-red-200';

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${colorClass}`}>
      <Target className="w-3.5 h-3.5" />
      {Math.round(confidence)}% CONFIDENCE
    </div>
  );
};

export const ConfidenceMeter: React.FC<{ confidence: number }> = ({ confidence }) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (confidence / 100) * circumference;
  let strokeColor = confidence < 50 ? "#ef4444" : confidence < 80 ? "#f59e0b" : "#3b82f6";

  return (
    <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
      <div className="relative flex items-center justify-center w-20 h-20">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="40" cy="40" r={radius} stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-200" />
          <motion.circle
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            cx="40"
            cy="40" r={radius} stroke={strokeColor} strokeWidth="8" fill="transparent"
            strokeDasharray={circumference} strokeLinecap="round"
          />
        </svg>
        <span className="absolute text-lg font-black text-slate-800">{Math.round(confidence)}%</span>
      </div>
      <div>
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-tighter">Plan Integrity</h4>
        <p className="text-[10px] text-slate-500 mt-1">Calculated multi-source certainty.</p>
      </div>
    </div>
  );
};

export const AgentLoopIndicator: React.FC<{ status: AgentStatus }> = ({ status }) => {
  const steps = [
    { id: AgentStatus.OBSERVING, label: 'Observe' },
    { id: AgentStatus.ORIENTING, label: 'Orient' },
    { id: AgentStatus.DECIDING, label: 'Decide' },
    { id: AgentStatus.ACTING, label: 'Act' },
    { id: AgentStatus.RECHECKING, label: 'Re-check' },
  ];
  return (
    <div className="flex flex-col gap-3 p-4 bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center gap-2 mb-2">
        <Activity className={`w-5 h-5 ${status !== AgentStatus.IDLE ? 'text-blue-600 animate-pulse' : 'text-slate-400'}`} />
        <h3 className="font-semibold text-slate-800 text-sm">Agentic Loop</h3>
      </div>
      <div className="relative flex justify-between items-center px-2">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-100 -translate-y-1/2" />
        {steps.map((step, idx) => {
          const isActive = status === step.id;
          const isPast = steps.findIndex(s => s.id === status) > idx;
          return (
            <div key={step.id} className="relative z-10 flex flex-col items-center gap-1">
              <div className={`w-3 h-3 rounded-full transition-all duration-300 ${isActive ? 'bg-blue-600 ring-4 ring-blue-100 scale-125' : isPast ? 'bg-blue-400' : 'bg-slate-200'}`} />
              <span className={`text-[8px] font-bold transition-colors uppercase ${isActive ? 'text-blue-700' : 'text-slate-400'}`}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const LoadingOverlay: React.FC<{ loading: boolean; location: string }> = ({ loading, location }) => (
  loading ? (
    <div className="absolute inset-0 z-[2000] bg-white/70 backdrop-blur flex items-center justify-center">
       <div className="bg-white p-8 rounded-3xl shadow-2xl border border-slate-100 flex flex-col items-center gap-5 text-center max-w-sm">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-blue-600/10 border-t-blue-600 rounded-full animate-spin" />
            <Zap className="absolute inset-0 m-auto w-8 h-8 text-blue-600 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Agentic Reasoning Active</h3>
            <p className="text-xs text-slate-500 mt-2 font-medium leading-relaxed">
              Searching weather patterns and data for <span className="text-blue-600 font-bold">{location}</span>.
            </p>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div className="h-full bg-blue-600" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }} />
          </div>
          <p className="text-[9px] text-slate-400 uppercase font-bold tracking-[0.2em]">Deep Thinking via Gemini 3</p>
       </div>
    </div>
  ) : null
);
