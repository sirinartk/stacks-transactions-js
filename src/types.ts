import {
  MAX_STRING_LENGTH_BYTES,
  MEMO_MAX_LENGTH_BYTES,
  PrincipalType,
  AddressHashMode,
  TransactionVersion,
} from './constants';

import { StacksPublicKey } from './keys';

import {
  BufferArray,
  intToHexString,
  hexStringToInt,
  exceedsMaxLengthBytes,
  hash_p2pkh,
  rightPadHexToLength,
} from './utils';

import { c32addressDecode, c32address } from 'c32check';
import { BufferReader } from './binaryReader';

export enum StacksMessageType {
  Address,
  LengthPrefixedString,
  MemoString,
  AssetInfo,
}

export type StacksMessage = Address | Principal | LengthPrefixedString | MemoString | AssetInfo;

export function serializeStacksMessage(message: StacksMessage): Buffer {
  switch (message.type) {
    case StacksMessageType.Address:
      return serializeAddress(message);
    case PrincipalType.Standard:
    case PrincipalType.Contract:
      return serializePrincipal(message);
    case StacksMessageType.LengthPrefixedString:
      return serializeLPString(message);
    case StacksMessageType.MemoString:
      return serializeMemoString(message);
    case StacksMessageType.AssetInfo:
      return serializeAssetInfo(message);
  }
}

export enum AddressVersion {
  MainnetSingleSig = 22,
  MainnetMultiSig = 20,
  TestnetSingleSig = 26,
  TestnetMultiSig = 21,
}

export interface Address {
  readonly type: StacksMessageType.Address;
  readonly version: number;
  readonly data: string;
}

export function address(c32AddressString: string): Address {
  const addressData = c32addressDecode(c32AddressString);
  return {
    type: StacksMessageType.Address,
    version: addressData[0],
    data: addressData[1],
  };
}

export function addressFromData(version: number, data: string): Address {
  return { type: StacksMessageType.Address, version, data };
}

/**
 * Translates the tx auth hash mode to the corresponding address version.
 * @see https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#transaction-authorization
 */
export function addressHashModeToVersion(
  hashMode: AddressHashMode,
  txVersion: TransactionVersion
): AddressVersion {
  switch (hashMode) {
    case AddressHashMode.SerializeP2PKH:
      switch (txVersion) {
        case TransactionVersion.Mainnet:
          return AddressVersion.MainnetSingleSig;
        case TransactionVersion.Testnet:
          return AddressVersion.TestnetSingleSig;
        default:
          throw new Error(`Unexpected txVersion ${txVersion} for hashMode ${hashMode}`);
      }
    case AddressHashMode.SerializeP2SH:
    case AddressHashMode.SerializeP2WPKH:
    case AddressHashMode.SerializeP2WSH:
      switch (txVersion) {
        case TransactionVersion.Mainnet:
          return AddressVersion.MainnetMultiSig;
        case TransactionVersion.Testnet:
          return AddressVersion.TestnetMultiSig;
        default:
          throw new Error(`Unexpected txVersion ${txVersion} for hashMode ${hashMode}`);
      }
    default:
      throw new Error(`Unexpected hashMode ${hashMode}`);
  }
}

export function fromHashMode(
  hashMode: AddressHashMode,
  txVersion: TransactionVersion,
  data: string
): Address {
  const version = addressHashModeToVersion(hashMode, txVersion);
  return addressFromData(version, data);
}

export function fromPublicKeys(
  version: number,
  hashMode: AddressHashMode,
  numSigs: number,
  publicKeys: Array<StacksPublicKey>
): Address {
  if (publicKeys.length === 0) {
    throw Error('Invalid number of public keys');
  }

  if (hashMode === AddressHashMode.SerializeP2PKH || hashMode === AddressHashMode.SerializeP2WPKH) {
    if (publicKeys.length !== 1 || numSigs !== 1) {
      throw Error('Invalid number of public keys or signatures');
    }
  }

  if (hashMode === AddressHashMode.SerializeP2WPKH || hashMode === AddressHashMode.SerializeP2WSH) {
    for (let i = 0; i < publicKeys.length; i++) {
      if (!publicKeys[i].compressed()) {
        throw Error('Public keys must be compressed for segwit');
      }
    }
  }

  switch (hashMode) {
    case AddressHashMode.SerializeP2PKH:
      return addressFromData(version, hash_p2pkh(publicKeys[0].toString()));
    default:
      throw Error('Invalid Address Hash Mode');
  }
}

export function addressToC32String(address: Address): string {
  return c32address(address.version, address.data).toString();
}

function serializeAddress(address: Address): Buffer {
  const bufferArray: BufferArray = new BufferArray();
  bufferArray.appendHexString(intToHexString(address.version, 1));
  bufferArray.appendHexString(address.data);

  return bufferArray.concatBuffer();
}

export function deserializeAddress(bufferReader: BufferReader): Address {
  const version = hexStringToInt(bufferReader.readBuffer(1).toString('hex'));
  const data = bufferReader.readBuffer(20).toString('hex');

  return { type: StacksMessageType.Address, version, data };
}

export type Principal = StandardPrincipal | ContractPrincipal;

export interface StandardPrincipal {
  type: PrincipalType.Standard;
  address: Address;
}

export interface ContractPrincipal {
  type: PrincipalType.Contract;
  address: Address;
  contractName: LengthPrefixedString;
}

export function standardPrincipal(addressString: string): StandardPrincipal {
  const addr = address(addressString);
  return { type: PrincipalType.Standard, address: addr };
}

export function contractPrincipal(addressString: string, contractName: string): ContractPrincipal {
  const addr = address(addressString);
  const name = lengthPrefixedString(contractName);
  return { type: PrincipalType.Contract, address: addr, contractName: name };
}

function serializePrincipal(principal: Principal): Buffer {
  const bufferArray: BufferArray = new BufferArray();
  bufferArray.push(Buffer.from([principal.type]));
  bufferArray.push(serializeAddress(principal.address));
  if (principal.type === PrincipalType.Contract) {
    bufferArray.push(serializeLPString(principal.contractName));
  }
  return bufferArray.concatBuffer();
}

export function deserializePrincipal(bufferReader: BufferReader): Principal {
  const type = bufferReader.readUInt8Enum(PrincipalType, n => {
    throw new Error('Unexpected Principal payload type: ${n}');
  });
  const address = deserializeAddress(bufferReader);
  const principal = { type, address };
  if (type === PrincipalType.Standard) {
    return principal as StandardPrincipal;
  }
  const contractName = deserializeLPString(bufferReader);
  return { type, address, contractName } as ContractPrincipal;
}

export interface LengthPrefixedString {
  readonly type: StacksMessageType.LengthPrefixedString;
  readonly content: string;
  readonly lengthPrefixBytes: number;
  readonly maxLengthBytes: number;
}

export function lengthPrefixedString(content: string): LengthPrefixedString;
export function lengthPrefixedString(
  content: string,
  lengthPrefixBytes: number
): LengthPrefixedString;
export function lengthPrefixedString(
  content: string,
  lengthPrefixBytes: number,
  maxLengthBytes: number
): LengthPrefixedString;
export function lengthPrefixedString(
  content: string,
  lengthPrefixBytes?: number,
  maxLengthBytes?: number
): LengthPrefixedString {
  const prefixLength = lengthPrefixBytes || 1;
  const maxLength = maxLengthBytes || MAX_STRING_LENGTH_BYTES;
  if (exceedsMaxLengthBytes(content, maxLength)) {
    throw new Error(`String length exceeds maximum bytes ${maxLength.toString()}`);
  }
  return {
    type: StacksMessageType.LengthPrefixedString,
    content,
    lengthPrefixBytes: prefixLength,
    maxLengthBytes: maxLength,
  };
}

function serializeLPString(lps: LengthPrefixedString) {
  const bufferArray: BufferArray = new BufferArray();
  const contentBuffer = Buffer.from(lps.content);
  const length = contentBuffer.byteLength;
  bufferArray.appendHexString(intToHexString(length, lps.lengthPrefixBytes));
  bufferArray.push(contentBuffer);
  return bufferArray.concatBuffer();
}

export function deserializeLPString(bufferReader: BufferReader) {
  const length = bufferReader.readUInt8();
  const content = bufferReader.readBuffer(length).toString();
  return lengthPrefixedString(content, length);
}

export function codeBodyString(content: string): LengthPrefixedString {
  return lengthPrefixedString(content, 4, 100000);
}

export interface MemoString {
  readonly type: StacksMessageType.MemoString;
  readonly content: string;
}

export function memoString(content: string): MemoString {
  if (content && exceedsMaxLengthBytes(content, MEMO_MAX_LENGTH_BYTES)) {
    throw new Error(`Memo exceeds maximum length of ${MEMO_MAX_LENGTH_BYTES.toString()} bytes`);
  }
  return { type: StacksMessageType.MemoString, content };
}

export function serializeMemoString(memoString: MemoString): Buffer {
  const bufferArray: BufferArray = new BufferArray();
  const contentBuffer = Buffer.from(memoString.content);
  const paddedContent = rightPadHexToLength(
    contentBuffer.toString('hex'),
    MEMO_MAX_LENGTH_BYTES * 2
  );
  bufferArray.push(Buffer.from(paddedContent, 'hex'));
  return bufferArray.concatBuffer();
}

export function deserializeMemoString(bufferReader: BufferReader): MemoString {
  const content = bufferReader.readBuffer(MEMO_MAX_LENGTH_BYTES).toString();
  return { type: StacksMessageType.MemoString, content };
}

export interface AssetInfo {
  readonly type: StacksMessageType.AssetInfo;
  readonly address: Address;
  readonly contractName: LengthPrefixedString;
  readonly assetName: LengthPrefixedString;
}

export function assetInfo(addressString: string, contractName: string, assetName: string) {
  return {
    address: address(addressString),
    contractName: lengthPrefixedString(contractName),
    assetName: lengthPrefixedString(assetName),
  };
}

export function serializeAssetInfo(info: AssetInfo): Buffer {
  const bufferArray: BufferArray = new BufferArray();
  bufferArray.push(serializeAddress(info.address));
  bufferArray.push(serializeLPString(info.contractName));
  bufferArray.push(serializeLPString(info.assetName));
  return bufferArray.concatBuffer();
}

export function deserializeAssetInfo(bufferReader: BufferReader): AssetInfo {
  return {
    type: StacksMessageType.AssetInfo,
    address: deserializeAddress(bufferReader),
    contractName: deserializeLPString(bufferReader),
    assetName: deserializeLPString(bufferReader),
  };
}

export interface LengthPrefixedList {
  readonly lengthPrefixBytes: number;
  readonly values: StacksMessage[];
}

export function lengthPrefixedList<T extends StacksMessage>(
  values: T[],
  lengthPrefixBytes?: number
): LengthPrefixedList {
  return {
    lengthPrefixBytes: lengthPrefixBytes || 4,
    values,
  };
}

function serializeLengthPrefixedList(lengthPrefixedList: LengthPrefixedList): Buffer {
  const list = lengthPrefixedList.values;
  const bufferArray: BufferArray = new BufferArray();
  bufferArray.appendHexString(intToHexString(list.length, lengthPrefixedList.lengthPrefixBytes));
  for (let index = 0; index < list.length; index++) {
    bufferArray.push(serializeStacksMessage(list[index]));
  }
  return bufferArray.concatBuffer();
}

export function deserializeLengthPrefixedList(
  bufferReader: BufferReader,
  lengthPrefixBytes: number,
  type: StacksMessageType | PrincipalType
): LengthPrefixedList {
  const length = hexStringToInt(bufferReader.readBuffer(lengthPrefixBytes).toString('hex'));
  const l: StacksMessage[] = [];
  for (let index = 0; index < length; index++) {
    switch (type) {
      case StacksMessageType.Address:
        l.push(deserializeAddress(bufferReader));
      case StacksMessageType.LengthPrefixedString:
        l.push(deserializeLPString(bufferReader));
      case StacksMessageType.MemoString:
        l.push(deserializeMemoString(bufferReader));
      case StacksMessageType.AssetInfo:
        l.push(deserializeAssetInfo(bufferReader));
      case PrincipalType.Standard:
      case PrincipalType.Contract:
        l.push(deserializePrincipal(bufferReader));
    }
  }
  return lengthPrefixedList(l, lengthPrefixBytes);
}
