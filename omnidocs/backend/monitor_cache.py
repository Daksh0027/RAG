#!/usr/bin/env python3
"""
Redis Cache Monitoring Tool for OmniDocs RAG

This script provides insights into your embedding cache:
- Total cached embeddings
- Cache memory usage
- Document vs Query embedding breakdown
- Sample cache entries
- Performance metrics

Usage:
    python monitor_cache.py
    python monitor_cache.py --clear-old  # Clear cache older than 25 days
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
import redis
from app.config import settings

def format_bytes(bytes_value):
    """Convert bytes to human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_value < 1024.0:
            return f"{bytes_value:.2f} {unit}"
        bytes_value /= 1024.0
    return f"{bytes_value:.2f} TB"

def format_time(seconds):
    """Convert seconds to human-readable format."""
    if seconds < 0:
        return "No expiration"
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    return f"{days}d {hours}h {minutes}m"

def analyze_cache():
    """Analyze the Redis embedding cache and display statistics."""
    try:
        # Connect to Redis
        client = redis.from_url(settings.REDIS_URL, decode_responses=False)
        client.ping()
        print(f"✓ Connected to Redis at {settings.REDIS_URL}\n")
    except Exception as e:
        print(f"✗ Failed to connect to Redis: {e}")
        return 1

    print("=" * 70)
    print("OmniDocs RAG Embedding Cache Analysis")
    print("=" * 70)
    
    # Get database info
    info = client.info()
    print(f"\n📊 Redis Database Info:")
    print(f"  Total Keys: {info['db0']['keys'] if 'db0' in info else 0}")
    print(f"  Memory Used: {format_bytes(info['used_memory'])}")
    print(f"  Memory Peak: {format_bytes(info['used_memory_peak'])}")
    print(f"  Uptime: {format_time(info['uptime_in_seconds'])}")
    
    # Scan for embedding keys
    print(f"\n🔍 Scanning Embedding Cache...")
    doc_embeddings = []
    query_embeddings = []
    cursor = 0
    
    while True:
        cursor, keys = client.scan(cursor, match='emb:*', count=100)
        for key in keys:
            key_str = key.decode('utf-8') if isinstance(key, bytes) else key
            if key_str.endswith(':0'):
                doc_embeddings.append(key)
            elif key_str.endswith(':1'):
                query_embeddings.append(key)
        if cursor == 0:
            break
    
    total_embeddings = len(doc_embeddings) + len(query_embeddings)
    
    print(f"\n📈 Cache Statistics:")
    print(f"  Total Cached Embeddings: {total_embeddings:,}")
    print(f"  └─ Document Chunks: {len(doc_embeddings):,} ({len(doc_embeddings)/max(total_embeddings,1)*100:.1f}%)")
    print(f"  └─ User Queries: {len(query_embeddings):,} ({len(query_embeddings)/max(total_embeddings,1)*100:.1f}%)")
    
    # Calculate storage
    if total_embeddings > 0:
        # Sample a few keys to estimate size
        sample_keys = (doc_embeddings[:5] + query_embeddings[:5])[:10]
        total_size = 0
        
        for key in sample_keys:
            try:
                size = client.memory_usage(key)
                if size:
                    total_size += size
            except:
                pass
        
        if total_size > 0:
            avg_size = total_size / len(sample_keys)
            estimated_total = avg_size * total_embeddings
            print(f"\n💾 Storage Estimates:")
            print(f"  Average Key Size: {format_bytes(avg_size)}")
            print(f"  Estimated Total: {format_bytes(estimated_total)}")
    
    # Sample cache entries
    if total_embeddings > 0:
        print(f"\n🔎 Sample Cache Entries:")
        samples = (doc_embeddings[:2] + query_embeddings[:2])[:4]
        
        for i, key in enumerate(samples, 1):
            key_str = key.decode('utf-8') if isinstance(key, bytes) else key
            ttl = client.ttl(key)
            value = client.get(key)
            
            try:
                embedding = json.loads(value)
                dim = len(embedding) if isinstance(embedding, list) else 'unknown'
            except:
                dim = 'unknown'
            
            key_type = "Document" if key_str.endswith(':0') else "Query"
            print(f"\n  [{i}] {key_type} Embedding")
            print(f"      Key: {key_str[:50]}...")
            print(f"      Dimensions: {dim}")
            print(f"      TTL: {format_time(ttl)}")
    
    # Cost savings estimate
    if total_embeddings > 0:
        # Gemini embedding API pricing (as of 2024): ~$0.00001 per embedding
        COST_PER_EMBEDDING = 0.00001
        savings = total_embeddings * COST_PER_EMBEDDING
        
        print(f"\n💰 Cost Savings:")
        print(f"  API Calls Saved: {total_embeddings:,}")
        print(f"  Estimated Savings: ${savings:.4f}")
        print(f"  (Assuming ${COST_PER_EMBEDDING} per embedding)")
    
    print("\n" + "=" * 70)
    
    return 0

def clear_old_cache(days=25):
    """Clear cache entries older than specified days."""
    try:
        client = redis.from_url(settings.REDIS_URL, decode_responses=False)
        client.ping()
    except Exception as e:
        print(f"✗ Failed to connect to Redis: {e}")
        return 1
    
    print(f"\n⚠️  Clearing cache entries older than {days} days...")
    print("This will force re-fetching embeddings from the API.\n")
    
    response = input("Are you sure? (yes/no): ")
    if response.lower() != 'yes':
        print("Cancelled.")
        return 0
    
    deleted = 0
    cursor = 0
    ttl_threshold = days * 86400
    
    while True:
        cursor, keys = client.scan(cursor, match='emb:*', count=100)
        for key in keys:
            ttl = client.ttl(key)
            # Keys with TTL less than threshold are older
            if 0 < ttl < ttl_threshold:
                client.delete(key)
                deleted += 1
        if cursor == 0:
            break
    
    print(f"✓ Deleted {deleted:,} old cache entries.")
    return 0

def main():
    parser = argparse.ArgumentParser(
        description="Monitor and manage OmniDocs RAG embedding cache"
    )
    parser.add_argument(
        '--clear-old',
        action='store_true',
        help='Clear cache entries older than 25 days'
    )
    parser.add_argument(
        '--days',
        type=int,
        default=25,
        help='Number of days threshold for clearing (default: 25)'
    )
    
    args = parser.parse_args()
    
    if args.clear_old:
        return clear_old_cache(args.days)
    else:
        return analyze_cache()

if __name__ == "__main__":
    sys.exit(main())
