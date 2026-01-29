
import React from 'react';
import { Navigation, CheckCircle2 } from 'lucide-react';
import { StatusBadge, ConfidenceBadge } from './UIComponents';
import { ClimatePlan } from '../types';

interface HeaderProps {
  activePlan: ClimatePlan | null;
}

export const Header: React.FC<HeaderProps> = ({ activePlan }) => (
  <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between z-10">
    <div className="flex items-center gap-4">
      <h2 className="font-bold text-slate-700 flex items-center gap-2">
        <Navigation className="w-4 h-4 text-blue-600" />
        Strategic Operational Center
      </h2>
      {activePlan && (
        <div className="flex items-center gap-3">
          <StatusBadge status={activePlan.riskLevel} />
          <ConfidenceBadge confidence={activePlan.overallConfidence} />
        </div>
      )}
    </div>
    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full uppercase tracking-widest">
      <CheckCircle2 className="w-3 h-3 text-green-500" />
      Gemini 3 Deep Think
    </div>
  </header>
);
