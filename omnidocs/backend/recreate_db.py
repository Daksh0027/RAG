import sys
from app.database import engine
from app.models import Base

def recreate_database():
    print("Connecting to database and dropping existing tables...")
    try:
        Base.metadata.drop_all(bind=engine)
        print("Successfully dropped all tables.")
        
        print("Recreating database schema with updated columns...")
        Base.metadata.create_all(bind=engine)
        print("Database schema successfully recreated!")
    except Exception as e:
        print(f"Error recreating database: {e}", file=sys.stderr)
        print("Make sure your Docker PostgreSQL container is running on port 5433.", file=sys.stderr)

if __name__ == "__main__":
    recreate_database()
