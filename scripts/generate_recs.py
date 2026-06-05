import os
import json
import pandas as pd
import psycopg2
import redis

def generate_recommendations():
    print("Starting ML Recommendation Engine...")
    
    db_url = os.environ.get('DATABASE_URL')
    redis_url = os.environ.get('REDIS_URL')
    
    if not db_url or not redis_url:
        print("Missing DATABASE_URL or REDIS_URL")
        return
        
    try:
        
        print("Connecting to database...")
        conn = psycopg2.connect(db_url)
        
        # 2. Load order_items into DataFrame
        print("Loading order_items...")
        query = "SELECT order_id, product_id FROM order_items;"
        df = pd.read_sql(query, conn)
        conn.close()
        
        if df.empty:
            print("No order items found.")
            return
            
        print(f"Loaded {len(df)} order items.")
        
        # 3. Build co-occurrence matrix
        print("Building co-occurrence matrix...")
        # Merge df with itself on order_id
        merged = pd.merge(df, df, on='order_id')
        
        # Filter out self-matches (product A with product A)
        merged = merged[merged['product_id_x'] != merged['product_id_y']]
        
        if merged.empty:
            print("No co-occurrences found.")
            return
            
        # Count co-occurrences
        co_counts = merged.groupby(['product_id_x', 'product_id_y']).size().reset_index(name='count')
        
        # 4. Extract top 5 for each product
        print("Extracting top 5 recommendations...")
        # Sort by product_id_x and count descending
        co_counts = co_counts.sort_values(['product_id_x', 'count'], ascending=[True, False])
        
        # Group by product_id_x and take top 5
        top_recs = co_counts.groupby('product_id_x').head(5)
        
        # 5. Connect to Redis and save
        print("Saving to Redis...")
        r = redis.from_url(redis_url)
        
        # Group by product_id_x to get list of product_id_y
        recs_dict = top_recs.groupby('product_id_x')['product_id_y'].apply(list).to_dict()
        
        count = 0
        for prod_id, rec_ids in recs_dict.items():
            key = f"recs:product:{prod_id}"
            # Convert numpy types to native Python types for JSON serialization
            rec_ids_clean = [int(x) for x in rec_ids]
            r.set(key, json.dumps(rec_ids_clean))
            count += 1
            
        print(f"Successfully saved recommendations for {count} products.")
        
    except Exception as e:
        print(f"Error generating recommendations: {e}")

if __name__ == "__main__":
    generate_recommendations()
