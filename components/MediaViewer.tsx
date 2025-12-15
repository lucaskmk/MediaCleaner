import React, { useEffect, useState, useRef } from 'react';
import { FileItem } from '../types';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface MediaViewerProps {
  item: FileItem;
  className?: string;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ item, className }) => {
  const [url, setUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  
  // Zoom & Pan State
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Create object URL for local file preview
    const objectUrl = URL.createObjectURL(item.file);
    objectUrlRef.current = objectUrl;
    setUrl(objectUrl);
    if (item.type === 'video') setVideoLoading(true);
    setThumbnailUrl(null);
    setShowVideo(false);

    // Generate thumbnail for videos (non-blocking)
    const generateThumbnail = async (file: File) => {
      try {
        const turl = URL.createObjectURL(file);
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.muted = true;
        vid.playsInline = true;
        vid.src = turl;

        const cleanup = () => {
          try { URL.revokeObjectURL(turl); } catch (e) {}
          vid.remove();
        };

        const capture = () => {
          try {
            const canvas = document.createElement('canvas');
            const w = vid.videoWidth || 320;
            const h = vid.videoHeight || 180;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(vid, 0, 0, w, h);
            return canvas.toDataURL('image/jpeg', 0.8);
          } catch (err) {
            return null;
          }
        };

        return await new Promise<string | null>((resolve) => {
          let settled = false;
          const tryResolve = (data: string | null) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(data);
          };

          const onLoaded = () => {
            try {
              // Seek to 0.5s or start
              const seekTime = Math.min(0.5, Math.max(0, (vid.duration || 0) / 10));
              vid.currentTime = seekTime;
            } catch (e) {
              // ignore seek errors
            }
            // Fallback: if seek doesn't fire, capture after small delay
            setTimeout(() => {
              const data = capture();
              tryResolve(data);
            }, 800);
          };

          const onSeeked = () => {
            const data = capture();
            tryResolve(data);
          };

          const onError = () => tryResolve(null);

          vid.addEventListener('loadedmetadata', onLoaded);
          vid.addEventListener('seeked', onSeeked);
          vid.addEventListener('error', onError);
        });
      } catch (err) {
        return null;
      }
    };

    if (item.type === 'video') {
      generateThumbnail(item.file).then((data) => {
        if (data) setThumbnailUrl(data);
        // keep videoLoading true until user clicks to play; thumbnail ready reduces load
      });
    }
    
    // Reset zoom on file change
    setScale(1);
    setPosition({ x: 0, y: 0 });

    return () => {
      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch (err) {
          // ignore
        }
        objectUrlRef.current = null;
      }
    };
  }, [item]);

  // Helper: fallback to data URL using FileReader when blob URLs repeatedly fail.
  const fallbackToDataUrl = (file: File) => {
    return new Promise<string | null>((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      } catch (err) {
        resolve(null);
      }
    });
  };

  // -- ZOOM HANDLERS --
  const handleWheel = (e: React.WheelEvent) => {
    if (item.type !== 'image') return;
    
    // Prevent default scrolling
    // e.stopPropagation(); 
    
    const delta = -e.deltaY * 0.002;
    const newScale = Math.min(Math.max(1, scale + delta), 8); // Max zoom 8x
    
    setScale(newScale);

    // If zooming out to 1, reset position
    if (newScale === 1) {
      setPosition({ x: 0, y: 0 });
    }
  };

  const adjustZoom = (delta: number) => {
    const newScale = Math.min(Math.max(1, scale + delta), 8);
    setScale(newScale);
    if (newScale === 1) setPosition({ x: 0, y: 0 });
  };

  // -- PAN HANDLERS --
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!url) return <div className="animate-pulse bg-slate-800 w-full h-full rounded-xl"></div>;

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full flex items-center justify-center bg-black rounded-xl overflow-hidden shadow-2xl ${className}`}
      onWheel={handleWheel}
    >
      {item.type === 'image' ? (
        <div 
          className="w-full h-full flex items-center justify-center cursor-move active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            src={url}
            alt={item.path}
            referrerPolicy="no-referrer"
            onError={() => {
              // Retry creating a fresh object URL in case the previous one was revoked or invalid
              if (objectUrlRef.current) {
                try { URL.revokeObjectURL(objectUrlRef.current); } catch (e) {}
              }
              const fresh = URL.createObjectURL(item.file);
              objectUrlRef.current = fresh;
              setUrl(fresh);
              // If the blob fails quickly again, fallback to data URL
              setTimeout(async () => {
                const data = await fallbackToDataUrl(item.file);
                if (data) setUrl(data);
              }, 1000);
            }}
            draggable={false}
            className="max-w-full max-h-full object-contain transition-transform duration-75 ease-out origin-center"
            style={{ 
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
              cursor: scale > 1 ? 'grab' : 'default'
            }}
          />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center relative">
          {thumbnailUrl && !showVideo && (
            <button
              onClick={() => { setShowVideo(true); setVideoLoading(true); }}
              className="w-full h-full flex items-center justify-center"
              title="Play video"
            >
              <img src={thumbnailUrl} alt={`${item.path} thumbnail`} draggable={false} className="max-w-full max-h-full object-contain" />
              <div className="absolute w-14 h-14 bg-black/60 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </button>
          )}

          {!thumbnailUrl && !showVideo && (
            <div className="absolute inset-0 flex items-center justify-center z-40">
              <div className="w-12 h-12 border-4 border-white/25 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {showVideo && (
            <video
              src={url ?? undefined}
              referrerPolicy="no-referrer"
              controls
              autoPlay
              preload="metadata"
              controlsList="nodownload noremoteplayback"
              disableRemotePlayback
              onLoadedMetadata={() => setVideoLoading(false)}
              onCanPlay={() => setVideoLoading(false)}
              onError={() => {
                console.warn('Video failed to load blob, recreating object URL');
                if (objectUrlRef.current) {
                  try { URL.revokeObjectURL(objectUrlRef.current); } catch (e) {}
                }
                const fresh = URL.createObjectURL(item.file);
                objectUrlRef.current = fresh;
                setUrl(fresh);
                setVideoLoading(true);

                // If retries don't help, fallback to data URL (slower but reliable)
                setTimeout(async () => {
                  const data = await fallbackToDataUrl(item.file);
                  if (data) {
                    setUrl(data);
                    setVideoLoading(false);
                  }
                }, 1500);
              }}
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>
      )}
      
      {/* Zoom Controls Overlay (Only for images) */}
      {item.type === 'image' && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-30">
          <button 
            onClick={() => adjustZoom(0.5)}
            className="p-2 bg-black/60 hover:bg-indigo-600 text-white rounded-full backdrop-blur-md transition-colors"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button 
             onClick={() => { setScale(1); setPosition({x:0, y:0}); }}
             className="p-2 bg-black/60 hover:bg-slate-600 text-white rounded-full backdrop-blur-md transition-colors"
             title="Reset Zoom"
          >
             <Maximize className="w-5 h-5" />
          </button>
          <button 
            onClick={() => adjustZoom(-0.5)}
            className="p-2 bg-black/60 hover:bg-indigo-600 text-white rounded-full backdrop-blur-md transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Path Overlay */}
      <div className="absolute top-0 left-0 w-full p-4 bg-gradient-to-b from-black/70 to-transparent pointer-events-none z-20">
        <h3 className="text-white font-medium truncate drop-shadow-md">{item.path}</h3>
        {scale > 1 && (
            <span className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider bg-black/50 px-2 py-0.5 rounded">
                Zoom x{scale.toFixed(1)}
            </span>
        )}
      </div>
    </div>
  );
};