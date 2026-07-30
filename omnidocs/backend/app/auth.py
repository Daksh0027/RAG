import jwt
import httpx
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import User

security = HTTPBearer()

# Cache for JWKS keys to avoid querying Clerk API on every single request
jwks_cache = None

async def get_jwks():
    global jwks_cache
    if jwks_cache is None:
        async with httpx.AsyncClient() as client:
            response = await client.get(settings.CLERK_JWKS_URL)
            response.raise_for_status()
            jwks_cache = response.json()
    return jwks_cache

async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> str:
    token = credentials.credentials
    try:
        # Get unverified header to extract the kid (Key ID)
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token is missing Key ID (kid)",
            )
        
        jwks = await get_jwks()
        
        # Look for the public key that matches the token's kid
        rsa_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                rsa_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                break
        
        # If not found, refresh the cached keys in case Clerk rotated them
        if not rsa_key:
            global jwks_cache
            jwks_cache = None
            jwks = await get_jwks()
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    rsa_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                    break
        
        if not rsa_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Valid public key not found for token signature verification",
            )
            
        # Decode and verify token signature/claims (with 60s leeway for client-server clock drift)
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            options={"verify_exp": True},
            leeway=60
        )
        
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token payload is missing user ID (sub claim)",
            )
            
        # Ensure user exists in our local PostgreSQL database to satisfy foreign key constraints
        db_user = db.query(User).filter(User.id == user_id).first()
        if not db_user:
            email = payload.get("email") or payload.get("primary_email_address")
            db_user = User(id=user_id, email=email)
            db.add(db_user)
            db.commit()

        return user_id

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired. Please sign in again.",
        )
    except (jwt.InvalidTokenError, httpx.HTTPError, Exception) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}",
        )
