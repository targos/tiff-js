import { IOBuffer } from 'iobuffer';

const CLEAR_CODE = 256;
const EOI_CODE = 257;
// 0-255 from the table + 256 for clear code + 257 for end of information code.
const TABLE_START = 258;
const MIN_BIT_LENGTH = 9;

const stringTable: number[][] = [];
for (let i = 0; i < 256; i++) {
  stringTable.push([i]);
}
// Fill the table with dummy data.
// Elements at indices > 257 will be replaced during decompression.
const dummyString = [] as number[];
for (let i = 256; i < 4096; i++) {
  stringTable.push(dummyString);
}

const andTable = [511, 1023, 2047, 4095];
const bitJumps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 1023, 2047, 4095];

class LzwDecoder {
  private stripArray: Uint8Array;
  private nextData: number;
  private nextBits: number;
  private bytePointer: number;
  private tableLength: number;
  private currentBitLength: number;
  private outData: IOBuffer;

  public constructor(data: DataView) {
    this.stripArray = new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
    this.tableLength = TABLE_START;
    this.currentBitLength = MIN_BIT_LENGTH;
    this.outData = new IOBuffer(data.byteLength);
    this.nextData = 0;
    this.nextBits = 0;
    this.bytePointer = 0;
  }

  public decode(debug = false): DataView {
    let code = 0;
    let oldCode = 0;
    while ((code = this.getNextCode()) !== EOI_CODE) {
      if (debug) {
        console.log(code);
      }
      if (code === CLEAR_CODE) {
        this.initializeTable();
        code = this.getNextCode();
        if (code === EOI_CODE) {
          break;
        }
        this.writeString(this.stringFromCode(code));
        oldCode = code;
      } else if (this.isInTable(code)) {
        this.writeString(this.stringFromCode(code));
        this.addStringToTable(
          this.stringFromCode(oldCode).concat(this.stringFromCode(code)[0]),
        );
        oldCode = code;
      } else {
        const outString = this.stringFromCode(oldCode).concat(
          this.stringFromCode(oldCode)[0],
        );
        this.writeString(outString);
        this.addStringToTable(outString);
        oldCode = code;
      }
    }
    const outArray = this.outData.toArray();
    return new DataView(
      outArray.buffer,
      outArray.byteOffset,
      outArray.byteLength,
    );
  }

  private initializeTable(): void {
    this.tableLength = TABLE_START;
    this.currentBitLength = MIN_BIT_LENGTH;
  }

  private writeString(string: number[]): void {
    this.outData.writeBytes(string);
  }

  private stringFromCode(code: number): number[] {
    // At this point, `code` must be defined in the table.
    return stringTable[code];
  }

  private isInTable(code: number): boolean {
    return code < this.tableLength;
  }

  private addStringToTable(string: number[]): void {
    stringTable[this.tableLength++] = string;
    if (stringTable.length > 4096) {
      throw new Error(
        'LZW decoding error. Please open an issue at https://github.com/image-js/tiff/issues/new/choose (include a test image).',
      );
    }
    if (this.tableLength === bitJumps[this.currentBitLength]) {
      this.currentBitLength++;
    }
  }

  private getNextCode(): number {
    this.nextData =
      (this.nextData << 8) | (this.stripArray[this.bytePointer++] & 0xff);
    this.nextBits += 8;

    if (this.nextBits < this.currentBitLength) {
      this.nextData =
        (this.nextData << 8) | (this.stripArray[this.bytePointer++] & 0xff);
      this.nextBits += 8;
    }

    const code =
      (this.nextData >> (this.nextBits - this.currentBitLength)) &
      andTable[this.currentBitLength - 9];
    this.nextBits -= this.currentBitLength;

    // this should not really happen but is present in other codes as well
    // see: https://github.com/sugark/Tiffus/blob/master/src/org/eclipse/swt/internal/image/TIFFLZWDecoder.java
    if (this.bytePointer > this.stripArray.length) {
      // eslint-disable-next-line no-console
      console.warn(
        'There seems to be a corruption in a strip not finished by EOI_CODE',
      );
      return 257;
    }

    return code;
  }
}

export function decompressLzw(stripData: DataView, debug = false): DataView {
  return new LzwDecoder(stripData).decode(debug);
}
