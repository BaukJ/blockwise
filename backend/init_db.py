"""Create DynamoDB tables locally (or against AWS)."""
from app.models import create_tables

if __name__ == "__main__":
    create_tables()
    print("Tables created.")
