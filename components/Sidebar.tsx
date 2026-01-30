
import React from 'react';
import { Upload, RefreshCcw, Thermometer, Wind, Droplets } from 'lucide-react';
import { AgentLoopIndicator } from './UIComponents';
import { AgentStatus, ClimatePlan } from '../types';

interface SidebarProps {
  location: string;
  setLocation: (loc: string) => void;
  selectedImage: File | null;
  setSelectedImage: (img: File | null) => void;
  loading: boolean;
  activePlan: ClimatePlan | null;
  agentStatus: AgentStatus;
  isCrisisEnabled: boolean;
  onStartAnalysis: () => void;
  onToggleCrisis: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  location, setLocation, selectedImage, setSelectedImage, loading, activePlan, agentStatus, isCrisisEnabled, onStartAnalysis, onToggleCrisis
  
}) => {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
    }
  };

  return (
    <aside className="w-80 flex-shrink-0 bg-white border-r border-slate-200 p-6 overflow-y-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="Climate Ops" className="w-16 h-16"/>
          <h1 className="font-bold text-xl tracking-tight text-slate-800">Climate Ops</h1>
        </div>
      </div>

      <section className="space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Location Focus</span>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1 block w-full rounded-lg border-slate-200 bg-slate-50 text-sm p-2 border" placeholder="e.g. Miami, FL" />
        </label>

        <div className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Multimodal Data</span>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex flex-col items-center justify-center h-20 border-2 border-dashed border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 cursor-pointer group">
              <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-500 mb-1" />
              <span className="text-[9px] text-slate-500 font-bold uppercase">SATELLITE IMAGE</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
            {selectedImage && (
              <div className="relative group">
                 <div className="w-full h-24 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center">
                   <div className="text-center text-xs">
                     <p className="font-semibold text-slate-700">{selectedImage.name}</p>
                     <p className="text-slate-500">{(selectedImage.size / 1024 / 1024).toFixed(2)} MB</p>
                   </div>
                 </div>
                 <button onClick={() => setSelectedImage(null)} className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"><RefreshCcw className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        </div>

        <button disabled={loading} onClick={onStartAnalysis} className={`w-full py-3 rounded-xl font-bold text-sm transition-all shadow-lg ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          {loading ? 'Reasoning...' : 'Initiate Operations Loop'}
        </button>
      </section>

      <section className="pt-4 border-t border-slate-100">
         <AgentLoopIndicator status={agentStatus} />
      </section>

      <section className="pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-3">
           <h3 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Dynamic Context</h3>
           <span className={`flex h-2 w-2 rounded-full ${activePlan ? 'bg-green-500' : 'bg-slate-300'}`} />
        </div>
        <div className="p-4 rounded-xl bg-slate-900 text-white space-y-4 shadow-inner">
           <div className="flex items-center justify-between text-xs">
             <div className="flex items-center gap-2"><Thermometer className="w-4 h-4 text-blue-400" /> Temp</div>
             <span className="font-bold">{activePlan ? `${activePlan.weather.temperature}°C` : '--'}</span>
           </div>
           <div className="flex items-center justify-between text-xs">
             <div className="flex items-center gap-2"><Wind className="w-4 h-4 text-blue-400" /> Wind</div>
             <span className="font-bold">{activePlan ? `${activePlan.weather.windSpeed} ${activePlan.weather.windDirection}` : '--'}</span>
           </div>
           <div className="flex items-center justify-between text-xs">
             <div className="flex items-center gap-2"><Droplets className="w-4 h-4 text-blue-400" /> Rain</div>
             <span className="font-bold">{activePlan ? activePlan.weather.rainfall : '--'}</span>
           </div>
           <button onClick={onToggleCrisis} disabled={!activePlan} className={`w-full py-2 rounded-lg text-xs font-bold transition-all ${isCrisisEnabled ? 'bg-red-600' : 'bg-slate-800 border border-slate-700'}`}>
             {isCrisisEnabled ? 'ACTIVE THREAT' : 'SIMULATE EVENT'}
           </button>
        </div>
      </section>
      
      <div className="text-[9px] text-slate-400 text-center px-2">
        This app uses the API keys configured in your environment (see `.env.local`).
        <div className="mt-1">Set `GEMINI_API_KEY` and `OPENWEATHER_API_KEY` to enable production requests.</div>
      </div>
    </aside>
  );
};
