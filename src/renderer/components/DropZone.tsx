import { useState, useCallback } from 'react';
import { FileInfo } from '../../shared/types';
import { UploadProgress } from '../api';

interface DropZoneProps {
  onFilesSelected: (files: FileInfo[]) => void;
  onProgress?: (progress: UploadProgress) => void;
}

export default function DropZone({ onFilesSelected, onProgress }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
  }, []);

  const upload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    setError(null);
    try {
      const uploaded = await window.lightningshare.uploadFiles(files, onProgress);
      if (uploaded.length > 0) onFilesSelected(uploaded);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not add those files');
    } finally {
      setIsUploading(false);
    }
  }, [onFilesSelected, onProgress]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    void upload(Array.from(e.dataTransfer.files));
  }, [upload]);

  const handleClick = useCallback(async () => {
    if (isUploading) return;
    setIsUploading(true);
    setError(null);
    try {
      const files = await window.lightningshare.selectFiles(onProgress);
      if (files.length > 0) onFilesSelected(files);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : 'Could not select files');
    } finally {
      setIsUploading(false);
    }
  }, [isUploading, onFilesSelected, onProgress]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => void handleClick()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleClick();
        }
      }}
      aria-busy={isUploading}
      className={`transfer-dropzone border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
        isDragOver
          ? 'border-primary-500 bg-primary-50'
          : 'border-slate-300 hover:border-primary-400 hover:bg-slate-50'
      }`}
    >
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-slate-700 mb-2">
        {isUploading ? 'Adding files...' : isDragOver ? 'Release to add files' : 'Drop files here to send'}
      </h3>
      <p className="text-sm text-slate-500">{isUploading ? 'Preparing files for transfer' : 'or click to browse'}</p>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
    </div>
  );
}
