
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, ExternalLink, BarChart3, Info, ShieldAlert, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from 'recharts';
import { ConfidenceMeter } from './UIComponents';
import { ClimatePlan } from '../types';

interface OperationsPlanProps {
  activePlan: ClimatePlan | null;
}

const ConfidenceRadar: React.FC<{ metrics: ClimatePlan['confidenceMetrics'] }> = ({ metrics }) => {
  const data = [
    { subject: 'Satellite', A: metrics.satellite || 0 },
    { subject: 'Weather', A: metrics.weather || 0 },
    { subject: 'Policy', A: metrics.documents || 0 },
  ];

  // Generate text interpretation of confidence levels
  const satelliteText = metrics.satellite >= 70 ? 'Strong satellite data' : 'Moderate satellite confidence';
  const weatherText = metrics.weather >= 70 ? 'High weather integration' : 'Limited weather data';
  const policyText = metrics.documents >= 70 ? 'Well-grounded policy alignment' : 'Emerging policy framework';

  return (
    <div className="space-y-3">
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
            <Radar name="Confidence" dataKey="A" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.6} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs text-slate-600 space-y-1 p-3 bg-slate-50 rounded border border-slate-100">
        <p>• <span className="font-semibold text-slate-700">{satelliteText}</span> ({metrics.satellite}%)</p>
        <p>• <span className="font-semibold text-slate-700">{weatherText}</span> ({metrics.weather}%)</p>
        <p>• <span className="font-semibold text-slate-700">{policyText}</span> ({metrics.documents}%)</p>
      </div>
    </div>
  );
};

export const OperationsPlan: React.FC<OperationsPlanProps> = ({ activePlan }) => {
  if (!activePlan) return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-300">
      <AlertTriangle className="w-12 h-12 mb-4 opacity-10" />
      <p className="text-center text-xs font-bold uppercase tracking-widest">Initialize Operational Loop</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 overflow-y-auto">
      <ConfidenceMeter confidence={activePlan.overallConfidence} />
      
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4 text-blue-600" /> Plan Summary
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed italic">"{activePlan.summary}"</p>
      </div>

      {activePlan.groundingUrls && activePlan.groundingUrls.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <ExternalLink className="w-3 h-3" /> Grounded Intelligence
          </h4>
          <div className="flex flex-wrap gap-2">
            {activePlan.groundingUrls.map((link, idx) => (
              <a key={idx} href={link.uri} target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded-md border border-blue-100 flex items-center gap-1 truncate max-w-full">
                {link.title.substring(0, 30)}...
              </a>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <BarChart3 className="w-3 h-3" /> Component Confidence
        </h4>
        <ConfidenceRadar metrics={activePlan.confidenceMetrics} />
      </div>

      <div className="space-y-4">
         <h4 className="text-sm font-bold text-slate-800">Operational Checklist</h4>
         {activePlan.checklists?.map((group, idx) => (
           <div key={idx} className="space-y-2">
             <h5 className="text-[10px] font-bold text-slate-500 bg-slate-100 py-1 px-2 rounded uppercase">{group.title}</h5>
             {group.items?.map((item, iIdx) => (
               <div key={iIdx} className="flex items-start gap-3 p-3 bg-white border border-slate-100 rounded-lg">
                 <input type="checkbox" className="mt-1 rounded text-blue-600" checked={item.completed} readOnly />
                 <div className="flex flex-col">
                   <span className="text-xs font-medium text-slate-800">{item.task}</span>
                   <span className={`text-[8px] font-bold ${item.priority === 'HIGH' ? 'text-red-500' : 'text-slate-400'}`}>
                     PRIORITY: {item.priority}
                   </span>
                 </div>
               </div>
             ))}
           </div>
         ))}
      </div>

      <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
        <h4 className="text-[10px] font-bold text-blue-800 mb-2 flex items-center gap-2 uppercase tracking-widest">
          <ShieldAlert className="w-4 h-4" /> Reasoning Trace
        </h4>
        <p className="text-[9px] text-blue-700 font-mono leading-tight whitespace-pre-wrap">{activePlan.reasoningTrace}</p>
      </div>
      {activePlan.rawAIResponse && (
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
          <h4 className="text-[10px] font-bold text-slate-600 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <Info className="w-4 h-4" /> AI Raw Response
          </h4>
          <details className="text-xs text-slate-700">
            <summary className="cursor-pointer font-medium">Show raw model output (JSON)</summary>
            <pre className="mt-2 p-2 bg-white rounded text-[10px] overflow-auto border border-slate-100 max-h-64">{JSON.stringify(activePlan.rawAIResponse, null, 2)}</pre>
          </details>
        </div>
      )}
    </motion.div>
  );
};
