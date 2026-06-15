// @ts-nocheck
import React, { memo } from 'react';
import { BaseEdge, getBezierPath } from '@xyflow/react';
export const ValidationEdge = memo((props: any) => {
  const [edgePath] = getBezierPath(props);
  return <BaseEdge path={edgePath} {...props} />;
});
export default ValidationEdge;
