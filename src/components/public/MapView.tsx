'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface Job {
  id: string;
  slug: string;
  city: string;
  image_url: string;
  gps_fuzzy_lat: number;
  gps_fuzzy_lng: number;
  service: {
    name: string;
  };
}

interface MapViewProps {
  jobs: Job[];
}

export function MapView({ jobs }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;
    if (map.current) return; // Initialize map only once

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error('Mapbox token not found');
      return;
    }

    mapboxgl.accessToken = token;

    // Initialize map centered on Colorado Front Range
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-104.8, 39.0], // Colorado Front Range
      zoom: 8,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded || jobs.length === 0) return;

    // Clear existing markers
    const existingMarkers = document.querySelectorAll('.mapboxgl-marker');
    existingMarkers.forEach((marker) => marker.remove());

    // Add markers for each job
    jobs.forEach((job) => {
      if (!job.gps_fuzzy_lat || !job.gps_fuzzy_lng) return;

      // Create popup content
      const popupContent = `
        <div style="min-width: 200px;">
          <img 
            src="${job.image_url}" 
            alt="${job.service.name}" 
            style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;"
          />
          <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${job.service.name}</h3>
          <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">${job.city}</p>
          <a 
            href="/work/${encodeURIComponent(job.city)}/${job.slug}" 
            style="color: #2563eb; text-decoration: none; font-size: 12px; font-weight: 500;"
          >
            View Details →
          </a>
        </div>
      `;

      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupContent);

      // Create marker
      const marker = new mapboxgl.Marker({ color: '#16a34a' })
        .setLngLat([job.gps_fuzzy_lng, job.gps_fuzzy_lat])
        .setPopup(popup)
        .addTo(map.current!);
    });

    // Fit map to show all markers if there are any
    if (jobs.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      jobs.forEach((job) => {
        if (job.gps_fuzzy_lat && job.gps_fuzzy_lng) {
          bounds.extend([job.gps_fuzzy_lng, job.gps_fuzzy_lat]);
        }
      });
      
      // Only fit bounds if we have valid bounds
      if (!bounds.isEmpty()) {
        map.current?.fitBounds(bounds, {
          padding: 50,
          maxZoom: 12,
        });
      }
    }
  }, [jobs, mapLoaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
