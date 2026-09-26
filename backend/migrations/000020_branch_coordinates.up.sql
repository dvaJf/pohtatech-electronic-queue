ALTER TABLE branches
 ADD COLUMN latitude double precision,
 ADD COLUMN longitude double precision,
 ADD COLUMN is_demo boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT branch_coordinate_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
 ADD CONSTRAINT branch_latitude_range CHECK (latitude BETWEEN -90 AND 90),
 ADD CONSTRAINT branch_longitude_range CHECK (longitude BETWEEN -180 AND 180);
