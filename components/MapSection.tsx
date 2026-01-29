
import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap, GeoJSON } from 'react-leaflet';
import { ClimatePlan } from '../types';

interface MapSectionProps {
  center: [number, number];
  location: string;
  activePlan: ClimatePlan | null;
}

const MapCenterUpdater: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
};

export const MapSection: React.FC<MapSectionProps> = ({ center, location, activePlan }) => {
  const [livePolygons, setLivePolygons] = useState<any | null>(null);

  useEffect(() => {
    let socket: any = null;
    // dynamic import to avoid bundling server libs on the server
    import('socket.io-client').then(({ io }) => {
      // connect to worker running on port 4000 by default
      const origin = window.location.origin;
      const workerOrigin = origin.replace(/:\d+$/, ':4000');
      socket = io(workerOrigin);
      socket.on('connect', () => console.log('socket connected', socket.id));
      socket.on('flood-polygons', (payload: any) => {
        if (payload?.collection) setLivePolygons(payload.collection);
      });
      socket.on('disconnect', () => console.log('socket disconnected'));
    }).catch((e) => console.warn('socket.io-client not available', e));

    return () => { if (socket) socket.disconnect(); };
  }, []);

  return (
    <div className="col-span-12 lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm p-3 relative overflow-hidden" style={{ height: '600px' }}>
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={center}><Popup>{location}</Popup></Marker>
        {activePlan?.floodPolygons?.map((poly, i) => (
          <Polygon key={`plan-${i}`} positions={poly} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 0.2 }} />
        ))}

        {livePolygons && (
          <GeoJSON data={livePolygons as any} style={() => ({ color: 'orange', weight: 2, fillColor: 'orange', fillOpacity: 0.25 })} />
        )}

        <MapCenterUpdater center={center} />
      </MapContainer>
    </div>
  );
};
