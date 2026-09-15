let hornAudio = null;

export function playBusHorn(onStart, onEnd) {
  const file = Math.random() < 0.5 ? "/truck-1.mp3" : "/truck-2.mp3";
  try {
    if (hornAudio) {
      hornAudio.pause();
      hornAudio.currentTime = 0;
    }
    hornAudio = new Audio(file);
    hornAudio.preload = "auto";
    hornAudio.volume = 1;
    
    const playPromise = hornAudio.play();
    if (playPromise?.catch) {
      playPromise.catch(err => console.error("Horn sound blocked/missing:", err));
    }
    
    if (onStart) onStart();
    hornAudio.addEventListener("ended", () => {
      if (onEnd) onEnd();
    }, { once: true });
    
    setTimeout(() => {
      if (onEnd) onEnd();
    }, 1800);
  } catch (error) {
    console.error("Horn error:", error);
  }
}