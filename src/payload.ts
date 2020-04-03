import { COINBASE_BUFFER_LENGTH_BYTES, PayloadType, AssetType } from './constants';

import { BufferArray } from './utils';

import {
  StacksMessage,
  AssetInfo,
  Address,
  MemoString,
  address,
  memoString,
  LengthPrefixedString,
  lengthPrefixedString,
  codeBodyString,
  serializeStacksMessage,
} from './types';

import { ClarityValue, serializeCV, deserializeCV } from './clarity/';

import * as BigNum from 'bn.js';
import { BufferReader } from './binaryReader';

type Payload =
  | TokenTransferPayload
  | ContractCallPayload
  | SmartContractPayload
  | PoisonPayload
  | CoinbasePayload;

interface TokenTransferPayload {
  readonly payloadType: PayloadType.TokenTransfer;
  readonly recipientAddress: Address;
  readonly amount: BigNum;
  readonly memo: MemoString;
}

function tokenTransferPayload(
  recipientAddress: string,
  amount: BigNum,
  memo?: string
): TokenTransferPayload {
  return {
    payloadType: PayloadType.TokenTransfer,
    recipientAddress: address(recipientAddress),
    amount,
    memo: memo ? memoString(memo) : memoString(''),
  };
}

interface ContractCallPayload {
  readonly payloadType: PayloadType.ContractCall;
  readonly contractAddress: Address;
  readonly contractName: LengthPrefixedString;
  readonly functionName: LengthPrefixedString;
  readonly functionArgs: ClarityValue[];
}

function contractCallPayload(
  contractAddress: string,
  contractName: string,
  functionName: string,
  functionArgs: ClarityValue[]
): ContractCallPayload {
  return {
    payloadType: PayloadType.ContractCall,
    contractAddress: address(contractAddress),
    contractName: lengthPrefixedString(contractName),
    functionName: lengthPrefixedString(functionName),
    functionArgs: functionArgs,
  };
}

interface SmartContractPayload {
  readonly payloadType: PayloadType.SmartContract;
  readonly contractName: LengthPrefixedString;
  readonly codeBody: LengthPrefixedString;
}

function smartContractPayload(contractName: string, codeBody: string): SmartContractPayload {
  return {
    payloadType: PayloadType.SmartContract,
    contractName: lengthPrefixedString(contractName),
    codeBody: codeBodyString(contractName),
  };
}

interface PoisonPayload {
  readonly payloadType: PayloadType.PoisonMicroblock;
}

function poisonPayload(): PoisonPayload {
  return { payloadType: PayloadType.PoisonMicroblock };
}

interface CoinbasePayload {
  payloadType: PayloadType.Coinbase;
  coinbaseBuffer: Buffer;
}

function coinbasePayload(coinbaseBuffer: Buffer) {
  if (coinbaseBuffer.byteLength != COINBASE_BUFFER_LENGTH_BYTES) {
    throw Error(`Coinbase buffer size must be ${COINBASE_BUFFER_LENGTH_BYTES} bytes`);
  }
  return { payloadType: PayloadType.Coinbase, coinbaseBuffer };
}

function serializePayload(payload: Payload): Buffer {
  const bufferArray: BufferArray = new BufferArray();
  bufferArray.appendByte(payload.payloadType);

  switch (payload.payloadType) {
    case PayloadType.TokenTransfer:
      bufferArray.push(serializeStacksMessage(payload.recipientAddress));
      bufferArray.push(payload.amount.toArrayLike(Buffer, 'be', 8));
      bufferArray.push(serializeStacksMessage(payload.memo));
      break;
    case PayloadType.ContractCall:
      bufferArray.push(serializeStacksMessage(payload.contractAddress));
      bufferArray.push(serializeStacksMessage(payload.contractName));
      bufferArray.push(serializeStacksMessage(payload.functionName));
      const numArgs = Buffer.alloc(4);
      numArgs.writeUInt32BE(payload.functionArgs.length, 0);
      bufferArray.push(numArgs);
      payload.functionArgs.forEach(arg => {
        bufferArray.push(serializeCV(arg));
      });
      break;
    case PayloadType.SmartContract:
      bufferArray.push(serializeStacksMessage(payload.contractName));
      bufferArray.push(serializeStacksMessage(payload.codeBody));
      break;
    case PayloadType.PoisonMicroblock:
      // TODO: implement
      break;
    case PayloadType.Coinbase:
      bufferArray.push(payload.coinbaseBuffer);
      break;
    default:
      break;
  }

  return bufferArray.concatBuffer();
}

// export class Payload extends StacksMessage {
//   payloadType?: PayloadType;

//   assetType?: AssetType;
//   assetInfo?: AssetInfo;
//   assetName?: LengthPrefixedString;
//   recipientAddress?: Address;
//   amount?: BigNum;
//   memo?: MemoString;

//   contractAddress?: Address;
//   contractName?: LengthPrefixedString;
//   functionName?: LengthPrefixedString;
//   functionArgs?: ClarityValue[];

//   codeBody?: CodeBodyString;

//   coinbaseBuffer?: Buffer;

//   serialize(): Buffer {
//     const bufferArray: BufferArray = new BufferArray();

//     if (this.payloadType === undefined) {
//       throw new Error('"payloadType" is undefined');
//     }
//     bufferArray.appendHexString(this.payloadType);

//     switch (this.payloadType) {
//       case PayloadType.TokenTransfer:
//         if (this.recipientAddress === undefined) {
//           throw new Error('"recipientAddress" is undefined');
//         }
//         bufferArray.push(this.recipientAddress.serialize());
//         if (this.amount === undefined) {
//           throw new Error('"amount" is undefined');
//         }
//         bufferArray.push(this.amount.toArrayLike(Buffer, 'be', 8));
//         if (this.memo === undefined) {
//           throw new Error('"memo" is undefined');
//         }
//         bufferArray.push(this.memo.serialize());
//         break;
//       case PayloadType.ContractCall:
//         if (this.contractAddress === undefined) {
//           throw new Error('"contractAddress" is undefined');
//         }
//         if (this.contractName === undefined) {
//           throw new Error('"contractName" is undefined');
//         }
//         if (this.functionName === undefined) {
//           throw new Error('"functionName" is undefined');
//         }
//         if (this.functionArgs === undefined) {
//           throw new Error('"functionArgs" is undefined');
//         }
//         bufferArray.push(this.contractAddress.serialize());
//         bufferArray.push(this.contractName.serialize());
//         bufferArray.push(this.functionName.serialize());
//         const numArgs = Buffer.alloc(4);
//         numArgs.writeUInt32BE(this.functionArgs.length, 0);
//         bufferArray.push(numArgs);
//         this.functionArgs.forEach(arg => {
//           bufferArray.push(serializeCV(arg));
//         });
//         break;
//       case PayloadType.SmartContract:
//         if (this.contractName === undefined) {
//           throw new Error('"contractName" is undefined');
//         }
//         if (this.codeBody === undefined) {
//           throw new Error('"codeBody" is undefined');
//         }
//         bufferArray.push(this.contractName.serialize());
//         bufferArray.push(this.codeBody.serialize());
//         break;
//       case PayloadType.PoisonMicroblock:
//         // TODO: implement
//         break;
//       case PayloadType.Coinbase:
//         if (this.coinbaseBuffer === undefined) {
//           throw new Error('"coinbaseBuffer" is undefined');
//         }
//         if (this.coinbaseBuffer.byteLength != COINBASE_BUFFER_LENGTH_BYTES) {
//           throw Error(`Coinbase buffer size must be ${COINBASE_BUFFER_LENGTH_BYTES} bytes`);
//         }
//         bufferArray.push(this.coinbaseBuffer);
//         break;
//       default:
//         break;
//     }

//     return bufferArray.concatBuffer();
//   }

// }
