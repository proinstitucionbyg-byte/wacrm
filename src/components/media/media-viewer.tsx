"use client";

import { useEffect, useState } from "react";
import { X, Download, RotateCw, Plus, Minus } from "lucide-react";

interface MediaViewerProps {
  open: boolean;
  imageUrl: string | null;
  onOpenChange: (open: boolean) => void;
}

export function MediaViewer({
  open,
  imageUrl,
  onOpenChange,
}: MediaViewerProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
  if (open) {
    setRotation(0);
    setZoom(1);
  }
}, [open, imageUrl]);
  if (!open) return null;

  return (
    <div
      onClick={() => onOpenChange(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.8)",
        zIndex: 999999,
overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(false);
        }}
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "transparent",
          border: "none",
          color: "white",
          cursor: "pointer",
        }}
      >
        <X size={36} />
            </button>

      <button
        onClick={(e) => {
          e.stopPropagation();

          if (!imageUrl) return;

          const link = document.createElement("a");
          link.href = imageUrl;
          link.download = "imagen";
          link.click();
        }}
        style={{
          position: "absolute",
          top: 20,
          right: 80,
          background: "transparent",
          border: "none",
          color: "white",
          cursor: "pointer",
        }}
      >
        <Download size={34} />
      </button>
      <button
  onClick={(e) => {
    e.stopPropagation();
    setZoom((z) => Math.max(z - 0.25, 0.25));
  }}
  style={{
    position: "absolute",
    top: 20,
    right: 260,
    background: "transparent",
    border: "none",
    color: "white",
    cursor: "pointer",
  }}
>
  <Minus size={34} />
</button>
      <button
  onClick={(e) => {
    e.stopPropagation();
    setZoom((z) => Math.min(z + 0.25, 3));
  }}
  style={{
    position: "absolute",
    top: 20,
    right: 200,
    background: "transparent",
    border: "none",
    color: "white",
    cursor: "pointer",
  }}
>
  <Plus size={34} />
</button>
<button
  onClick={(e) => {
    e.stopPropagation();
    setRotation((r) => (r + 90) % 360);
  }}
  style={{
    position: "absolute",
    top: 20,
    right: 140,
    background: "transparent",
    border: "none",
    color: "white",
    cursor: "pointer",
  }}
>
  <RotateCw size={34} />
</button>
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Vista previa"
          onClick={(e) => e.stopPropagation()}
          style={{
  maxWidth: "90vw",
  maxHeight: "90vh",
  objectFit: "contain",
  transform: `scale(${zoom}) rotate(${rotation}deg)`,
  transition: "transform 0.3s ease",
}}
        />
      )}
    </div>
  );
}