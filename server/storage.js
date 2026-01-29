// Storage abstraction layer - supports local filesystem and Cloudflare R2
// Usage: import { storage } from './storage.js'; 
//        const url = await storage.save(buffer, 'filename.tiff');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local'; // 'local' or 'r2'

// Ensure data dir exists for local storage
if (STORAGE_TYPE === 'local' && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============= Local Storage =============
const localStorage = {
  async save(buffer, filename) {
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return `file://${filepath}`; // Return file:// URL for local dev
  },
  
  async load(filepath) {
    // Extract actual path from file:// URL or use directly
    const actualPath = filepath.startsWith('file://') 
      ? filepath.slice(7) 
      : filepath;
    return fs.readFileSync(actualPath);
  },
  
  async list() {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR);
  },
  
  async delete(filepath) {
    const actualPath = filepath.startsWith('file://') 
      ? filepath.slice(7) 
      : filepath;
    if (fs.existsSync(actualPath)) {
      fs.unlinkSync(actualPath);
    }
  }
};

// ============= Cloudflare R2 Storage (S3-compatible) =============
let r2Client;
let r2Bucket;
let r2Endpoint;

const r2Storage = {
  async init() {
    if (r2Client) return;
    
    try {
      const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
        throw new Error('Missing R2 config: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
      }
      
      r2Endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      r2Bucket = process.env.R2_BUCKET;
      
      r2Client = new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      
      console.log(`[Storage] R2 initialized: ${r2Endpoint}/${r2Bucket}`);
    } catch (err) {
      console.error('Failed to initialize R2 client:', err.message);
      throw err;
    }
  },
  
  async save(buffer, filename) {
    await this.init();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    
    const key = `imagery/${filename}`;
    await r2Client.send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream'
    }));
    
    // Return public URL if R2_PUBLIC_DOMAIN is set, otherwise use direct endpoint
    const publicDomain = process.env.R2_PUBLIC_DOMAIN || `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    return `https://${publicDomain}/${key}`;
  },
  
  async load(r2Url) {
    await this.init();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    
    // Extract key from URL (handles both public domain and storage endpoint)
    const key = r2Url.split('/').slice(3).join('/'); // Skip protocol and domain
    
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: r2Bucket,
      Key: key
    }));
    
    return await response.Body.transformToByteArray();
  },
  
  async list() {
    await this.init();
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    
    const response = await r2Client.send(new ListObjectsV2Command({
      Bucket: r2Bucket,
      Prefix: 'imagery/'
    }));
    
    return (response.Contents || []).map(obj => obj.Key.replace('imagery/', ''));
  },
  
  async delete(r2Url) {
    await this.init();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    
    // Extract key from URL
    const key = r2Url.split('/').slice(3).join('/');
    
    await r2Client.send(new DeleteObjectCommand({
      Bucket: r2Bucket,
      Key: key
    }));
  }
};

// ============= Storage Router =============
export const storage = {
  async save(buffer, filename) {
    console.log(`[Storage] Saving ${filename} to ${STORAGE_TYPE}`);
    
    switch (STORAGE_TYPE) {
      case 'r2':
        return await r2Storage.save(buffer, filename);
      case 'local':
      default:
        return await localStorage.save(buffer, filename);
    }
  },
  
  async load(filepath) {
    console.log(`[Storage] Loading from ${filepath}`);
    
    switch (STORAGE_TYPE) {
      case 'r2':
        return await r2Storage.load(filepath);
      case 'local':
      default:
        return await localStorage.load(filepath);
    }
  },
  
  async list() {
    switch (STORAGE_TYPE) {
      case 'r2':
        return await r2Storage.list();
      case 'local':
      default:
        return await localStorage.list();
    }
  },
  
  async delete(filepath) {
    console.log(`[Storage] Deleting ${filepath}`);
    
    switch (STORAGE_TYPE) {
      case 'r2':
        return await r2Storage.delete(filepath);
      case 'local':
      default:
        return await localStorage.delete(filepath);
    }
  },
  
  getType() {
    return STORAGE_TYPE;
  }
};

export default storage;
