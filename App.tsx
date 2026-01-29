
import React from 'react';
import { useClimateOps } from './hooks/useClimateOps';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MapSection } from './components/MapSection';
import { OperationsPlan } from './components/OperationsPlan';
import { LoadingOverlay } from './components/UIComponents';

export default function App() {
  const {
    activePlan,
    agentStatus,
    loading,
    location,
    setLocation,
    selectedImage,
    setSelectedImage,
    isCrisisEnabled,
    mapCenter,
    startAnalysis,
    toggleCrisisMode,
    handleKeySelection
  } = useClimateOps();

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        location={location}
        setLocation={setLocation}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
        loading={loading}
        activePlan={activePlan}
        agentStatus={agentStatus}
        isCrisisEnabled={isCrisisEnabled}
        onStartAnalysis={startAnalysis}
        onToggleCrisis={toggleCrisisMode}
        
      />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Header activePlan={activePlan} />

        <div className="flex-1 p-8 overflow-hidden">
          <div className="grid grid-cols-12 gap-6 h-full">
            <MapSection
              center={mapCenter}
              location={location}
              activePlan={activePlan}
            />

            <div className="col-span-12 lg:col-span-4 flex flex-col overflow-y-auto">
              <OperationsPlan activePlan={activePlan} />
            </div>
          </div>
        </div>

        <LoadingOverlay loading={loading} location={location} />
      </main>
    </div>
  );
}
