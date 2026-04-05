import { useGLTF } from '@react-three/drei';
import { useState, useEffect } from 'react';

export function useAvatarModel(agentId: string) {
  const [modelExists, setModelExists] = useState<boolean | null>(null);
  const modelPath = `/models/${agentId}.glb`;

  useEffect(() => {
    // Check if model file exists
    fetch(modelPath, { method: 'HEAD' })
      .then(response => {
        setModelExists(response.ok);
      })
      .catch(() => {
        setModelExists(false);
      });
  }, [modelPath]);

  // Only try to load if we know the model exists
  let model = null;
  if (modelExists === true) {
    try {
      const gltf = useGLTF(modelPath);
      model = gltf.scene;
    } catch (error) {
      // Failed to load, use fallback
      model = null;
    }
  }

  return { model, loading: modelExists === null };
}
