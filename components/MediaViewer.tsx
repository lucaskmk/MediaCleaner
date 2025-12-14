import React, { useEffect, useState, useRef } from 'react';
import { FileItem } from '../types';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface MediaViewerProps {
  item: FileItem;
  className?: string;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ item, className }) => {
  const [url, setUrl] = useState<string | null>(null);
  
  // Zoom & Pan State
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Create object URL for local file preview
    const objectUrl = URL.createObjectURL(item.file);
    setUrl(objectUrl);
    
    // Reset zoom on file change
    setScale(1);
    setPosition({ x: 0, y: 0 });

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [item]);

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
            draggable={false}
            className="max-w-full max-h-full object-contain transition-transform duration-75 ease-out origin-center"
            style={{ 
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
              cursor: scale > 1 ? 'grab' : 'default'
            }}
          />
        </div>
      ) : (
        <video
          src={url}
          controls
          autoPlay
          loop
          className="max-w-full max-h-full object-contain"
        />
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