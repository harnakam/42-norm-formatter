#include "custom_type_header.h"

t_user *find_user_by_id(t_user *users,FILE *stream,int id)
{
t_user *u;
u=users;
if(!stream)return NULL;
while(u && u->id!=id)
u++;
return u;
}
