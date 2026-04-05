'use client';

import type { AgentConfig } from './agentsConfig';
import ProceduralAvatar from './ProceduralAvatars';

interface AvatarProps {
  agent: AgentConfig;
  position: [number, number, number];
}

export default function Avatar({ agent, position }: AvatarProps) {
  return <ProceduralAvatar agent={agent} position={position} />;
}
