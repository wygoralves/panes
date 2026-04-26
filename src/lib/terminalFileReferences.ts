export interface TerminalBufferPosition {
  x: number;
  y: number;
}

export interface TerminalBufferRange {
  start: TerminalBufferPosition;
  end: TerminalBufferPosition;
}

export function offsetToTerminalBufferPosition(
  startLine: number,
  lineLengths: number[],
  offset: number,
): TerminalBufferPosition {
  let remaining = offset;
  for (let index = 0; index < lineLengths.length; index += 1) {
    const lineLength = lineLengths[index];
    if (remaining < lineLength) {
      return {
        x: remaining + 1,
        y: startLine + index + 1,
      };
    }

    remaining -= lineLength;
  }

  const lastLineLength = lineLengths[lineLengths.length - 1] ?? 0;
  return {
    x: lastLineLength,
    y: startLine + lineLengths.length,
  };
}

export function terminalMatchOffsetsToRange(
  startLine: number,
  lineLengths: number[],
  startOffset: number,
  endOffsetExclusive: number,
): TerminalBufferRange {
  const inclusiveEndOffset = Math.max(startOffset, endOffsetExclusive - 1);
  return {
    start: offsetToTerminalBufferPosition(startLine, lineLengths, startOffset),
    end: offsetToTerminalBufferPosition(startLine, lineLengths, inclusiveEndOffset),
  };
}
