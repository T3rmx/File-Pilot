from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query, Request, WebSocket, WebSocketDisconnect

from .deps import current_user
from .models import User
from .security import new_token

router = APIRouter(tags=["realtime"])


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.rooms.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        room = self.rooms.get(user_id)
        if room:
            room.discard(websocket)
            if not room:
                self.rooms.pop(user_id, None)

    async def broadcast_user(self, user_id: str, payload: dict) -> None:
        for socket in list(self.rooms.get(user_id, ())):
            try:
                await socket.send_json(payload)
            except Exception:
                self.disconnect(user_id, socket)


@router.post("/api/ws/ticket")
def ws_ticket(request: Request, user: User = Depends(current_user)) -> dict:
    ticket = new_token(24)
    state = request.app.state
    now = time.time()
    for key in [key for key, value in state.tickets.items() if value["expires"] < now]:
        state.tickets.pop(key, None)
    state.tickets[ticket] = {"user_id": user.id, "expires": now + 60}
    return {"ticket": ticket, "expires_in": 60}


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, ticket: str = Query(default="")) -> None:
    state = websocket.app.state
    entry = state.tickets.pop(ticket, None) if ticket else None
    if not entry or entry["expires"] < time.time():
        await websocket.close(code=4401)
        return
    user_id = entry["user_id"]
    await state.ws.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        state.ws.disconnect(user_id, websocket)
