import React, { useState, useRef, useEffect } from "react";

const RadioPlayer: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlayPause = () => {
    if (audioRef.current) {
      audioRef.current.volume = 0.1;
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.src = "http://localhost:3000/stream";
        audioRef.current.play().catch((error) => {
          console.error("Error playing audio:", error);
        });
      }
      setIsPlaying(!isPlaying);
    }
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.onerror = (e) => {
        console.error("Audio error:", e);
        setIsPlaying(false);
      };
    }
  }, []);

  return (
    <div className="radio-player">
      <h2>Radio Player</h2>
      <audio ref={audioRef} />
      <button onClick={togglePlayPause}>{isPlaying ? "Stop" : "Play"}</button>
    </div>
  );
};

export default RadioPlayer;
