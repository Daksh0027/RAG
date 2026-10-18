#!/usr/bin/env python3
"""Quick test to verify Redis connection and populate sample data."""

import json
import redis
from app.config import settings

def test_redis():
    print(f"Testing Redis connection to: {settings.REDIS_URL}")
    
    try:
        # Connect to Redis
        client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        client.ping()
        print("✓ Redis connection successful!\n")
        
        # Add some sample cache entries
        print("Adding sample embedding cache entries...")
        
        sample_embeddings = {
            "emb:sample_doc_hash1:0": [0.1] * 3072,  # Document embedding
            "emb:sample_doc_hash2:0": [0.2] * 3072,  # Document embedding
            "emb:sample_query_hash1:1": [0.3] * 3072,  # Query embedding
        }
        
        for key, embedding in sample_embeddings.items():
            # Set with 30 day TTL (like the real cache)
            client.setex(key, 60 * 60 * 24 * 30, json.dumps(embedding))
            print(f"  ✓ Created: {key}")
        
        print(f"\n✓ Added {len(sample_embeddings)} sample cache entries")
        print(f"✓ Total keys in database: {client.dbsize()}")
        print("\nRefresh Redis Insight to see the new keys!")
        
        return True
        
    except redis.ConnectionError as e:
        print(f"✗ Failed to connect to Redis: {e}")
        print("\nMake sure Redis is running:")
        print("  docker-compose up redis -d")
        return False
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    success = test_redis()
    exit(0 if success else 1)
