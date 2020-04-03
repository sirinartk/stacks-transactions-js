import {
  StacksMessage,
  serializeStacksMessage,
  StacksMessageType,
  deserializeStacksMessage,
} from '../../src/types';
import { BufferReader } from '../../src/binaryReader';

export function serializeDeserialize(value: StacksMessage, type: StacksMessageType): StacksMessage {
  const serialized = serializeStacksMessage(value);
  const bufferReader = new BufferReader(serialized);
  return deserializeStacksMessage(bufferReader, type);
}
