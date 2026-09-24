-- [Ext] Reservation lifecycle guard (tasks T094; spec FR-014d, Lifecycles "Reservation").
-- Status may only move waiting → ready | cancelled and ready → fulfilled | expired | cancelled;
-- the reader and book of a reservation never change.

CREATE TRIGGER `trg_reservations_bu` BEFORE UPDATE ON `reservations`
FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(128);
  IF NEW.reader_id <> OLD.reader_id OR NEW.book_id <> OLD.book_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: a reservation cannot change reader or book';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'waiting' AND NEW.status IN ('ready', 'cancelled'))
    OR (OLD.status = 'ready'   AND NEW.status IN ('fulfilled', 'expired', 'cancelled'))) THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: reservation ', OLD.status, ' -> ', NEW.status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
END;
