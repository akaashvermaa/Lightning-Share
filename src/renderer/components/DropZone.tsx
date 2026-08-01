import { useState, useRef, useCallback } from 'react';
import { FileInfo } from '../../shared/types';

interface DropZoneProps {
  onFilesSelected: (files: FileInfo[]) => void;
}

export default function DropZone({ onFilesSelected }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFileSelect = async () => {
    const files = await window.lightningshare.selectFiles();
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`transfer-dropzone border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
        isDragOver
          ? 'border-primary-500 bg-primary-50'
          : 'border-slate-300 hover:border-primary-400 hover:bg-slate-50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-slate-700 mb-2">
        Drop files here to send
      </h3>
      <p className="text-sm text-slate-500">
        or click to browse
      </p>
    </div>
  );
}
