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
  }[];
}

interface Sighting {
  id: string;
  image_url: string;
  gps_lat: number;
  gps_lng: number;
  created_at: string;
}

interface MapViewProps {
  jobs: Job[];
  sightings: Sighting[];
}

export function MapView({ jobs, sightings }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

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
      // Clean up markers first
      markersRef.current.forEach(marker => {
        try {
          marker.remove();
        } catch (e) {
          console.error('Error removing marker:', e);
        }
      });
      markersRef.current = [];
      
      // Then remove map
      if (map.current) {
        try {
          map.current.remove();
        } catch (e) {
          console.error('Error removing map:', e);
        }
        map.current = null;
      }
      setMapLoaded(false);
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (jobs.length === 0 && sightings.length === 0) return;

    // Clear existing markers
    markersRef.current.forEach(marker => {
      try {
        marker.remove();
      } catch (error) {
        console.error('Error removing marker:', error);
      }
    });
    markersRef.current = [];

    // Add GREEN markers for each job
    jobs.forEach((job) => {
      if (!job.gps_fuzzy_lat || !job.gps_fuzzy_lng) return;
      if (!map.current) return;

      try {
        // Create popup content
        const serviceName = job.service?.[0]?.name || 'Service';
        const popupContent = `
          <div style="min-width: 200px;">
            <img 
              src="${job.image_url}" 
              alt="${serviceName}" 
              style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;"
            />
            <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${serviceName}</h3>
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

        // Create GREEN marker for jobs
        const marker = new mapboxgl.Marker({ color: '#16a34a' })
          .setLngLat([job.gps_fuzzy_lng, job.gps_fuzzy_lat])
          .setPopup(popup)
          .addTo(map.current);
        
        markersRef.current.push(marker);
      } catch (error) {
        console.error('Error adding job marker:', error);
      }
    });

    // Add BLUE markers for each sighting
    sightings.forEach((sighting) => {
      if (!sighting.gps_lat || !sighting.gps_lng) return;
      if (!map.current) return;

      try {
        // Format date
        const date = new Date(sighting.created_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });

        // Create popup content
        const popupContent = `
          <div style="min-width: 200px;">
            <img 
              src="${sighting.image_url}" 
              alt="Sasquatch Spotted" 
              style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;"
            />
            <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">🦍 Sasquatch Spotted!</h3>
            <p style="margin: 0; font-size: 12px; color: #666;">${date}</p>
          </div>
        `;

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupContent);

        // Create BLUE marker for sightings
        const marker = new mapboxgl.Marker({ color: '#2563eb' })
          .setLngLat([sighting.gps_lng, sighting.gps_lat])
          .setPopup(popup)
          .addTo(map.current);
        
        markersRef.current.push(marker);
      } catch (error) {
        console.error('Error adding sighting marker:', error);
      }
    });

    // Fit map to show all markers if there are any
    const allPoints: [number, number][] = [];
    
    jobs.forEach((job) => {
      if (job.gps_fuzzy_lat && job.gps_fuzzy_lng) {
        allPoints.push([job.gps_fuzzy_lng, job.gps_fuzzy_lat]);
      }
    });
    
    sightings.forEach((sighting) => {
      if (sighting.gps_lat && sighting.gps_lng) {
        allPoints.push([sighting.gps_lng, sighting.gps_lat]);
      }
    });

    if (allPoints.length > 0 && map.current) {
      try {
        const bounds = new mapboxgl.LngLatBounds();
        allPoints.forEach((point) => {
          bounds.extend(point);
        });
        
        // Only fit bounds if we have valid bounds
        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, {
            padding: 50,
            maxZoom: 12,
          });
        }
      } catch (error) {
        console.error('Error fitting bounds:', error);
      }
    }
  }, [jobs, sightings, mapLoaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
